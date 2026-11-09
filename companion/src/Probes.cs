// Reads of the outside world (Docker's engine pipe, the bridge's HTTP, the relay's WebSocket, TCP listeners, processes)
// and the child-process runner. Every read has a timeout; "slow" is never reported as "down" (spec §3).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Management;
using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace MtgCompanion
{
    public class RunResult { public int Exit = -1; public string Output = ""; public bool TimedOut; public string Error; }

    public static class Probes
    {
        // ───────────────────────────── child processes ─────────────────────────────

        // Runs a program hidden, collects stdout+stderr, kills it at the timeout. onLine sees each line as it comes;
        // onTick runs about once a second with the process (for progress).
        public static RunResult Run(string exe, string args, int timeoutMs, Action<string> onLine, Action<Process> onTick, IDictionary<string, string> env, string cwd)
        {
            var r = new RunResult();
            var sb = new StringBuilder();
            var psi = new ProcessStartInfo(exe, args);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            if (cwd != null) psi.WorkingDirectory = cwd;
            if (env != null) foreach (var kv in env) psi.EnvironmentVariables[kv.Key] = kv.Value;
            try
            {
                using (var p = new Process())
                {
                    p.StartInfo = psi;
                    DataReceivedEventHandler h = (s, e) =>
                    {
                        if (e.Data == null) return;
                        lock (sb) sb.AppendLine(e.Data);
                        if (onLine != null) try { onLine(e.Data); } catch { }
                    };
                    p.OutputDataReceived += h;
                    p.ErrorDataReceived += h;
                    p.Start();
                    p.BeginOutputReadLine();
                    p.BeginErrorReadLine();
                    var sw = Stopwatch.StartNew();
                    while (!p.WaitForExit(1000))
                    {
                        if (onTick != null) try { onTick(p); } catch { }
                        if (sw.ElapsedMilliseconds > timeoutMs)
                        {
                            r.TimedOut = true;
                            try { p.Kill(); } catch { }
                            p.WaitForExit(5000);
                            break;
                        }
                    }
                    if (!r.TimedOut) { p.WaitForExit(); r.Exit = p.ExitCode; }
                }
            }
            catch (Exception e) { r.Error = e.Message; }
            lock (sb) r.Output = sb.ToString();
            return r;
        }

        // ───────────────────────────── Docker ─────────────────────────────

        static string pipeName; // the engine pipe that answered last

        // GET over Docker's engine pipe, as plain HTTP/1.0 (no child process). Returns null when no pipe answers.
        public static HttpResult DockerGet(string path, int timeoutMs)
        {
            var names = pipeName != null ? new[] { pipeName } : new[] { "dockerDesktopLinuxEngine", "docker_engine" };
            foreach (var name in names)
            {
                var r = PipeGet(name, path, timeoutMs);
                if (r != null) { pipeName = name; return r; }
            }
            pipeName = null;
            return null;
        }

        static HttpResult PipeGet(string name, string path, int timeoutMs)
        {
            NamedPipeClientStream pipe = null;
            try
            {
                pipe = new NamedPipeClientStream(".", name, PipeDirection.InOut);
                pipe.Connect(Math.Min(timeoutMs, 700));
            }
            catch { if (pipe != null) pipe.Dispose(); return null; }
            var sw = Stopwatch.StartNew();
            var p = pipe;
            var t = Task.Run(() =>
            {
                var req = Encoding.ASCII.GetBytes("GET " + path + " HTTP/1.0\r\nHost: docker\r\n\r\n");
                p.Write(req, 0, req.Length);
                p.Flush();
                var ms = new MemoryStream();
                var buf = new byte[65536];
                int n;
                while ((n = p.Read(buf, 0, buf.Length)) > 0) ms.Write(buf, 0, n);
                return ms.ToArray();
            });
            try
            {
                if (!t.Wait(timeoutMs)) { pipe.Dispose(); return new HttpResult { Kind = HttpKind.Timeout, Error = "Docker's engine didn't answer in " + timeoutMs / 1000 + " s" }; }
                var raw = t.Result;
                pipe.Dispose();
                return ParseHttp(raw, sw.ElapsedMilliseconds);
            }
            catch (Exception e) { pipe.Dispose(); return new HttpResult { Kind = HttpKind.Error, Error = Inner(e).Message }; }
        }

        public static HttpResult ParseHttp(byte[] raw, long ms)
        {
            int end = -1;
            for (int i = 0; i + 3 < raw.Length; i++)
                if (raw[i] == 13 && raw[i + 1] == 10 && raw[i + 2] == 13 && raw[i + 3] == 10) { end = i; break; }
            if (end < 0) return new HttpResult { Kind = HttpKind.Error, Error = "no HTTP header", Ms = ms };
            string head = Encoding.ASCII.GetString(raw, 0, end);
            var first = head.Split('\n')[0].Split(' ');
            int status = 0;
            if (first.Length > 1) int.TryParse(first[1], out status);
            var body = new byte[raw.Length - end - 4];
            Array.Copy(raw, end + 4, body, 0, body.Length);
            if (head.IndexOf("Transfer-Encoding: chunked", StringComparison.OrdinalIgnoreCase) >= 0) body = Dechunk(body);
            return new HttpResult { Kind = HttpKind.Ok, Status = status, Body = Encoding.UTF8.GetString(body), Ms = ms };
        }

        static byte[] Dechunk(byte[] b)
        {
            var o = new MemoryStream();
            int i = 0;
            while (i < b.Length)
            {
                int nl = i;
                while (nl + 1 < b.Length && !(b[nl] == 13 && b[nl + 1] == 10)) nl++;
                string hex = Encoding.ASCII.GetString(b, i, nl - i).Split(';')[0].Trim();
                int size;
                if (!int.TryParse(hex, System.Globalization.NumberStyles.HexNumber, null, out size) || size == 0) break;
                i = nl + 2;
                if (i + size > b.Length) size = b.Length - i;
                o.Write(b, i, size);
                i += size + 2;
            }
            return o.ToArray();
        }

        // docker.exe: on PATH, else Docker Desktop's resources\bin
        public static string FindDockerCli()
        {
            var path = Environment.GetEnvironmentVariable("PATH") ?? "";
            foreach (var d in path.Split(';'))
            {
                try { var f = Path.Combine(d.Trim().Trim('"'), "docker.exe"); if (d.Trim().Length > 0 && File.Exists(f)) return f; } catch { }
            }
            var desk = FindDockerDesktop();
            if (desk != null)
            {
                var f = Path.Combine(Path.GetDirectoryName(desk), "resources", "bin", "docker.exe");
                if (File.Exists(f)) return f;
            }
            var def = @"C:\Program Files\Docker\Docker\resources\bin\docker.exe";
            return File.Exists(def) ? def : null;
        }

        // Docker Desktop.exe: the uninstall key's InstallLocation, else the default folder
        public static string FindDockerDesktop()
        {
            try
            {
                using (var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Docker Desktop"))
                {
                    if (k != null)
                    {
                        var loc = k.GetValue("InstallLocation") as string;
                        if (!string.IsNullOrEmpty(loc))
                        {
                            var f = Path.Combine(loc, "Docker Desktop.exe");
                            if (File.Exists(f)) return f;
                        }
                    }
                }
            }
            catch { }
            var def = @"C:\Program Files\Docker\Docker\Docker Desktop.exe";
            return File.Exists(def) ? def : null;
        }

        public static bool ProcessRunning(string name)
        {
            try { var ps = Process.GetProcessesByName(name); bool any = ps.Length > 0; foreach (var p in ps) p.Dispose(); return any; }
            catch { return false; }
        }

        // One container by compose project + service, through the engine pipe (labels, so container_name doesn't matter)
        public static ContainerInfo Container(string project, string service, out string error)
        {
            error = null;
            string filter = "{\"label\":[\"com.docker.compose.project=" + project + "\",\"com.docker.compose.service=" + service + "\"]}";
            var list = DockerGet("/containers/json?all=1&filters=" + Uri.EscapeDataString(filter), 8000);
            if (list == null) { error = "Docker isn't answering"; return null; }
            if (list.Kind != HttpKind.Ok || list.Status != 200) { error = list.Error ?? ("HTTP " + list.Status); return null; }
            var arr = J.Parse(list.Body) as object[];
            if (arr == null || arr.Length == 0) return new ContainerInfo { Exists = false };
            string id = J.Str(arr[0], "Id");
            var one = DockerGet("/containers/" + id + "/json", 8000);
            if (one == null || one.Kind != HttpKind.Ok || one.Status != 200) { error = one == null ? "Docker isn't answering" : (one.Error ?? ("HTTP " + one.Status)); return null; }
            var o = J.Parse(one.Body);
            var st = J.Get(o, "State");
            return new ContainerInfo
            {
                Exists = true, Id = id, Name = (J.Str(o, "Name") ?? "").TrimStart('/'),
                State = J.Str(st, "Status"), Health = J.Str(J.Get(st, "Health"), "Status") ?? "",
                Image = J.Str(o, "Image"), Restarts = J.Int(o, "RestartCount"),
            };
        }

        // An image's id, or null when it is missing; error is set when Docker can't say
        public static string ImageId(string tag, out string error)
        {
            error = null;
            var r = DockerGet("/images/" + tag + "/json", 8000);
            if (r == null) { error = "Docker isn't answering"; return null; }
            if (r.Kind != HttpKind.Ok) { error = r.Error; return null; }
            if (r.Status == 404) return null;
            if (r.Status != 200) { error = "HTTP " + r.Status; return null; }
            return J.Str(J.Parse(r.Body), "Id");
        }

        // ───────────────────────────── the bridge's HTTP ─────────────────────────────

        public static HttpResult HttpGet(string url, int timeoutMs)
        {
            var sw = Stopwatch.StartNew();
            try
            {
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.Proxy = null; // (spec §3: the default proxy lookup cost 350 ms)
                req.Timeout = timeoutMs;
                req.ReadWriteTimeout = timeoutMs;
                req.KeepAlive = false;
                using (var resp = (HttpWebResponse)req.GetResponse())
                using (var rd = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                    return new HttpResult { Kind = HttpKind.Ok, Status = (int)resp.StatusCode, Body = rd.ReadToEnd(), Ms = sw.ElapsedMilliseconds };
            }
            catch (WebException e)
            {
                var hr = e.Response as HttpWebResponse;
                if (hr != null) { int code = (int)hr.StatusCode; hr.Close(); return new HttpResult { Kind = HttpKind.Ok, Status = code, Body = "", Ms = sw.ElapsedMilliseconds }; }
                var se = FindSocketError(e);
                if (e.Status == WebExceptionStatus.ConnectFailure && (se == null || se.SocketErrorCode == SocketError.ConnectionRefused))
                    return new HttpResult { Kind = HttpKind.Refused, Error = "nothing listens", Ms = sw.ElapsedMilliseconds };
                if (e.Status == WebExceptionStatus.Timeout)
                    return new HttpResult { Kind = HttpKind.Timeout, Error = "no answer in " + timeoutMs / 1000 + " s", Ms = sw.ElapsedMilliseconds };
                return new HttpResult { Kind = HttpKind.Error, Error = e.Message, Ms = sw.ElapsedMilliseconds };
            }
            catch (Exception e) { return new HttpResult { Kind = HttpKind.Error, Error = e.Message, Ms = sw.ElapsedMilliseconds }; }
        }

        static SocketException FindSocketError(Exception e)
        {
            for (var x = e; x != null; x = x.InnerException) { var s = x as SocketException; if (s != null) return s; }
            return null;
        }

        static Exception Inner(Exception e)
        {
            while ((e is AggregateException || e is System.Reflection.TargetInvocationException) && e.InnerException != null) e = e.InnerException;
            return e;
        }

        // ───────────────────────────── the relay login (catches the stale 9443 forward) ─────────────────────────────

        // Logs in as companion-xxxx with the bridge's own messages, asks for the room list, and closes properly
        // (a lobby session that closes is removed by the relay at once).
        public static LoginResult RelayLogin(string url, string key, string room, int stepMs)
        {
            var r = new LoginResult();
            var sw = Stopwatch.StartNew();
            var ws = new ClientWebSocket();
            try
            {
                try { ws.Options.Proxy = null; } catch { }
                try
                {
                    using (var cts = new CancellationTokenSource(stepMs)) ws.ConnectAsync(new Uri(url), cts.Token).Wait();
                }
                catch (Exception e)
                {
                    var se = FindSocketError(e);
                    r.Kind = se != null && se.SocketErrorCode == SocketError.ConnectionRefused ? LoginKind.Refused
                           : (Inner(e) is OperationCanceledException || Inner(e) is TaskCanceledException) ? LoginKind.Timeout : LoginKind.Closed;
                    r.Detail = Inner(e).Message;
                    return r;
                }
                var user = "companion-" + Guid.NewGuid().ToString("N").Substring(0, 4);
                Send(ws, J.Write(new Dictionary<string, object> {
                    { "type", "Authenticate" }, { "username", user }, { "password", key }, { "service", false },
                    { "client_platform", "unknown" }, { "engine_gate", "unknown" }, { "client_version", "3.56.0" } }), stepMs);
                var auth = WaitFor(ws, "AuthResult", stepMs);
                if (auth == null) { r.Kind = ws.State == WebSocketState.Open ? LoginKind.Timeout : LoginKind.Closed; r.Detail = "no AuthResult"; return r; }
                if (!J.Bool(auth, "success")) { r.Kind = LoginKind.AuthFailed; r.Detail = J.Str(auth, "error"); return r; }
                Send(ws, "{\"type\":\"ListRooms\"}", stepMs);
                var list = WaitFor(ws, "RoomList", stepMs);
                if (list == null) { r.Kind = ws.State == WebSocketState.Open ? LoginKind.Timeout : LoginKind.Closed; r.Detail = "no RoomList"; return r; }
                r.Kind = LoginKind.Ok;
                var rooms = J.Arr(list, "rooms") ?? new object[0];
                object found = null;
                foreach (var x in rooms) if (J.Str(x, "room_name") == room && J.Str(x, "status") == "Lobby") { found = x; break; }
                if (found == null) foreach (var x in rooms) if (J.Str(x, "room_name") == room) { found = x; break; }
                r.RoomFound = found != null;
                r.RoomStatus = found == null ? null : J.Str(found, "status");
                r.Ms = sw.ElapsedMilliseconds;
                return r;
            }
            catch (Exception e) { r.Kind = LoginKind.Error; r.Detail = Inner(e).Message; return r; }
            finally
            {
                try
                {
                    if (ws.State == WebSocketState.Open)
                        using (var cts = new CancellationTokenSource(2000)) ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", cts.Token).Wait();
                }
                catch { }
                ws.Dispose();
            }
        }

        static void Send(ClientWebSocket ws, string text, int ms)
        {
            var b = Encoding.UTF8.GetBytes(text);
            using (var cts = new CancellationTokenSource(ms)) ws.SendAsync(new ArraySegment<byte>(b), WebSocketMessageType.Text, true, cts.Token).Wait();
        }

        // Reads messages until one of this type comes (others are skipped), or the time is up
        static object WaitFor(ClientWebSocket ws, string type, int ms)
        {
            var until = DateTime.UtcNow.AddMilliseconds(ms);
            var buf = new byte[65536];
            while (DateTime.UtcNow < until && ws.State == WebSocketState.Open)
            {
                var msg = new MemoryStream();
                WebSocketReceiveResult res;
                do
                {
                    int left = (int)Math.Max(1, (until - DateTime.UtcNow).TotalMilliseconds);
                    try
                    {
                        using (var cts = new CancellationTokenSource(left))
                        {
                            var t = ws.ReceiveAsync(new ArraySegment<byte>(buf), cts.Token);
                            t.Wait();
                            res = t.Result;
                        }
                    }
                    catch { return null; }
                    if (res.MessageType == WebSocketMessageType.Close) return null;
                    msg.Write(buf, 0, res.Count);
                } while (!res.EndOfMessage);
                var o = J.Parse(Encoding.UTF8.GetString(msg.ToArray()));
                if (J.Str(o, "type") == type) return o;
            }
            return null;
        }

        // ───────────────────────────── TCP listeners with their owner (iphlpapi, no netstat) ─────────────────────────────

        [DllImport("iphlpapi.dll", SetLastError = true)]
        static extern uint GetExtendedTcpTable(IntPtr table, ref int size, bool sort, int af, int tableClass, uint reserved);

        // every listener on these ports (IPv4 and IPv6), with process name and command line when Windows gives them
        public static List<Listener> Listeners(params int[] ports)
        {
            var want = new HashSet<int>(ports);
            var found = new List<Listener>();
            foreach (var af in new[] { 2, 23 })
            {
                int size = 0;
                GetExtendedTcpTable(IntPtr.Zero, ref size, false, af, 3 /* TCP_TABLE_OWNER_PID_LISTENER */, 0);
                if (size <= 0) continue;
                IntPtr buf = Marshal.AllocHGlobal(size);
                try
                {
                    if (GetExtendedTcpTable(buf, ref size, false, af, 3, 0) != 0) continue;
                    int n = Marshal.ReadInt32(buf);
                    int rowSize = af == 2 ? 24 : 56;
                    int portOff = af == 2 ? 8 : 20, pidOff = af == 2 ? 20 : 52;
                    for (int i = 0; i < n; i++)
                    {
                        IntPtr row = IntPtr.Add(buf, 4 + i * rowSize);
                        uint rawPort = (uint)Marshal.ReadInt32(row, portOff);
                        int port = (int)(((rawPort & 0xFF) << 8) | ((rawPort >> 8) & 0xFF));
                        int pid = Marshal.ReadInt32(row, pidOff);
                        if (!want.Contains(port) || found.Any(f => f.Port == port && f.Pid == pid)) continue;
                        found.Add(new Listener { Port = port, Pid = pid });
                    }
                }
                finally { Marshal.FreeHGlobal(buf); }
            }
            foreach (var l in found)
            {
                try { using (var p = Process.GetProcessById(l.Pid)) l.Name = p.ProcessName; } catch { }
                l.CommandLine = CommandLine(l.Pid);
            }
            return found;
        }

        public static string CommandLine(int pid)
        {
            try
            {
                using (var s = new ManagementObjectSearcher("SELECT CommandLine FROM Win32_Process WHERE ProcessId = " + pid))
                    foreach (ManagementObject o in s.Get()) using (o) return o["CommandLine"] as string;
            }
            catch { }
            return null;
        }

        // processes by exe name whose command line contains every given piece (case-insensitive); null when WMI fails
        public static List<int> FindProcesses(string exeName, params string[] pieces)
        {
            var ids = new List<int>();
            try
            {
                using (var s = new ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = '" + exeName.Replace("'", "") + "'"))
                    foreach (ManagementObject o in s.Get())
                        using (o)
                        {
                            var cmd = (o["CommandLine"] as string ?? "").Replace('/', '\\').ToLowerInvariant();
                            if (pieces.All(p => cmd.Contains(p.Replace('/', '\\').ToLowerInvariant()))) ids.Add(Convert.ToInt32(o["ProcessId"]));
                        }
            }
            catch { return null; }
            return ids;
        }

        public static List<int> FindBridgeNodes()
        {
            var ids = new List<int>();
            try
            {
                using (var s = new ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name = 'node.exe'"))
                    foreach (ManagementObject o in s.Get())
                        using (o) if (Logic.IsBridgeCommandLine(o["CommandLine"] as string)) ids.Add(Convert.ToInt32(o["ProcessId"]));
            }
            catch { return null; }
            return ids;
        }

        public static void Kill(IEnumerable<int> pids)
        {
            if (pids == null) return;
            foreach (var id in pids)
                try { using (var p = Process.GetProcessById(id)) { p.Kill(); p.WaitForExit(5000); } } catch { }
        }

        // ───────────────────────────── misc ─────────────────────────────

        [StructLayout(LayoutKind.Sequential)]
        struct IoCounters { public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes; }

        [DllImport("kernel32.dll", SetLastError = true)]
        static extern bool GetProcessIoCounters(IntPtr process, out IoCounters counters);

        // bytes a process has read so far (docker load's progress through the tar)
        public static long BytesRead(Process p)
        {
            try { IoCounters c; return GetProcessIoCounters(p.Handle, out c) ? (long)c.ReadBytes : -1; } catch { return -1; }
        }

        public static bool SteamFound()
        {
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam"))
                    return k != null && (k.GetValue("SteamPath") != null || k.GetValue("SteamExe") != null);
            }
            catch { return false; }
        }

        // the last bytes of a log (shared read: the bridge may be writing)
        public static string Tail(string file, int bytes)
        {
            try
            {
                using (var f = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                {
                    long start = Math.Max(0, f.Length - bytes);
                    f.Seek(start, SeekOrigin.Begin);
                    var b = new byte[f.Length - start];
                    int got = 0, n;
                    while (got < b.Length && (n = f.Read(b, got, b.Length - got)) > 0) got += n;
                    return Encoding.UTF8.GetString(b, 0, got);
                }
            }
            catch { return null; }
        }

        public static string ReadText(string file)
        {
            try { return File.ReadAllText(file); } catch { return null; }
        }
    }
}
