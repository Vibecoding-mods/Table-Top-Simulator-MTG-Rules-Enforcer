// The status page: a small HTTP/1.1 server on 127.0.0.1 that serves one page (WebPage.cs) and a JSON API over the
// Controller. The tray's "Open status" (and a click on the tray icon) opens it in the default browser; StatusForm
// stays as the fallback (--no-web, --shot, no free port, or no browser). A TcpListener with its own parser, because
// HttpListener can need a URL ACL (netsh http add urlacl) or admin rights; a loopback socket needs neither.
//
//   GET  /              the page, with this run's token and a CSP nonce put in
//   GET  /api/status    the lights, the game lock, the menu, versions, the log tail (shape: Status() below)
//   POST /api/action    {"id": "...", "confirmLocked": bool}: the same Controller calls and game lock as the window
//   GET  /api/tools     the bridge's table tools (AI seats, debug tools), passed through from the bridge's GET /tools
//   POST /api/tools     {"kind": "ai-seat"|"debug-mode"|"debug", ...}: one change, passed to the bridge (Tools() below)
//
// /api/status, version 1 ("api": 1):
//   app, at, mode ("friend"|"home"), home, observe, phase
//   worst    {state, busy, text}            the header: the worst light, in words
//   game     {kind ("none"|"on"|"cantTell"), text, turn, locked, lockText}
//   lights   [{step, name, state, busy, word, text, hint, at, action}]  six rows; state is green|amber|red|grey (a
//            light that is working is amber with busy:true, drawn blue); action is null or one button:
//            {id ("fix:<row>:<fix>"), label, locked, lockText, confirm}
//   menu     [{id, label, enabled, title, confirm, confirmLocked}]  restart-engine, stop-everything, open-logs, wsl-limits
//   hint     the help line (the first hint of an amber/red light, else how to load the table in TTS)
//   versions {text, companion, table, bridge, save}
//   log      {file, lines}                   the last lines of companion.log
//   update   the self-update (docs/companion-app-spec.md §11), friend mode only (null in home mode and observe):
//            {title, line, status, current, available, progress, deferred, error, lastCheck, actions}; actions in the
//            menu's shape: update-now (when a release is offered), update-later, update-check. Built from the
//            Controller's one UpdateState snapshot (UpdateSection). The page shows the section only when it is an object.
// POST /api/action answers {ok, message, needConfirm}; ok:false is a refusal (game lock, observe mode, a stale button).
// update-now never waits for the game lock: it downloads, and the install itself waits for the game to end.
// A second restart-engine, stop-everything or fix while the same one is still queued or running answers ok with
// "Already running" and does nothing.
//
// Guards (DNS rebinding, CSRF): Host must be 127.0.0.1:<port> or localhost:<port>; an Origin, when sent, must be that
// origin; /api/* needs the X-MTG-Token header (16 random bytes per run, only ever written into the served page) and
// refuses Sec-Fetch-Site other than same-origin/none; POST needs Content-Type exactly application/json (charset=utf-8
// allowed), so a cross-origin form can't send one without a CORS preflight, which gets no CORS headers. Responses:
// no-store, nosniff, frame DENY, no referrer, CSP. At most MaxOpen connections: past that the oldest one still waiting
// for its request is closed, so idle sockets can't lock the page out; a request must arrive within 10 s.
// C# 5 only (csc 4.8): no $"", no ?., no => members, no nameof, no out var.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace MtgCompanion
{
    public class HttpReq
    {
        public string Method, Target, Path, Version, Body = "";
        public int ContentLength;
        public readonly Dictionary<string, string> Headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        public int Error; public string Why; // (Error: the status to answer with; 0 when the request parsed)

        public string Header(string name) { string v; return Headers.TryGetValue(name, out v) ? v : null; }
        public static HttpReq Fail(int status, string why) { return new HttpReq { Error = status, Why = why }; }
    }

    public class HttpResp
    {
        public int Status; public string Body; public string Type = "application/json; charset=utf-8"; public string Csp;
        public HttpResp(int status, string body) { Status = status; Body = body ?? ""; }
    }

    // The smallest HTTP/1.1 that a browser and curl need: one request per connection, Content-Length bodies only.
    // Anything unusual is refused rather than guessed at (bare LF, folded or duplicate headers, chunked bodies).
    public static class MiniHttp
    {
        public const int MaxHead = 8192, MaxBody = 16384, MaxHeaders = 50;
        // (a second copy of these is an attack or a bug, never something to merge)
        static readonly HashSet<string> Single = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            { "Host", "Content-Length", "Content-Type", "Origin", "Sec-Fetch-Site", WebUi.TokenHeader };

        // One request from s. null: the peer closed without sending anything. Error != 0: refused (answer that status).
        public static HttpReq Read(Stream s, int maxHead, int maxBody, DateTime deadline)
        {
            var buf = new byte[maxHead];
            int got = 0, end = -1;
            while (end < 0)
            {
                if (got >= maxHead) return HttpReq.Fail(431, "the request head is over " + maxHead + " bytes");
                if (DateTime.UtcNow > deadline) return HttpReq.Fail(408, "the request came too slowly");
                int n = s.Read(buf, got, maxHead - got);
                if (n <= 0) return got == 0 ? null : HttpReq.Fail(400, "the connection closed inside the request head");
                int from = Math.Max(0, got - 3);
                got += n;
                end = HeadEnd(buf, from, got);
            }
            for (int i = 0; i < end; i++)
            {
                byte b = buf[i];
                if (b > 126 || (b < 32 && b != 13 && b != 10 && b != 9)) return HttpReq.Fail(400, "a non-ASCII or control byte in the request head");
            }
            var r = ParseHead(Encoding.ASCII.GetString(buf, 0, end), maxBody);
            if (r.Error != 0) return r;
            var body = new byte[r.ContentLength];
            int have = Math.Min(r.ContentLength, got - (end + 4));
            Array.Copy(buf, end + 4, body, 0, have);
            while (have < body.Length)
            {
                if (DateTime.UtcNow > deadline) return HttpReq.Fail(408, "the body came too slowly");
                int n = s.Read(body, have, body.Length - have);
                if (n <= 0) return HttpReq.Fail(400, "the body is shorter than Content-Length");
                have += n;
            }
            try { r.Body = new UTF8Encoding(false, true).GetString(body); }
            catch (DecoderFallbackException) { return HttpReq.Fail(400, "the body isn't UTF-8"); }
            return r;
        }

        // index of the blank line's "\r\n\r\n" in buf[0..got), searching from `from`; -1 when not there yet
        static int HeadEnd(byte[] buf, int from, int got)
        {
            for (int i = from; i + 3 < got; i++)
                if (buf[i] == 13 && buf[i + 1] == 10 && buf[i + 2] == 13 && buf[i + 3] == 10) return i;
            return -1;
        }

        // The request line and headers (without the blank line)
        public static HttpReq ParseHead(string head, int maxBody)
        {
            var lines = head.Split(new[] { "\r\n" }, StringSplitOptions.None);
            foreach (var l in lines)
                if (l.IndexOf('\r') >= 0 || l.IndexOf('\n') >= 0) return HttpReq.Fail(400, "a bare CR or LF");
            var rl = lines[0].Split(' ');
            if (rl.Length != 3 || !IsToken(rl[0]) || rl[1].Length == 0) return HttpReq.Fail(400, "a malformed request line");
            if (rl[0] != rl[0].ToUpperInvariant()) return HttpReq.Fail(400, "a lower-case method");
            if (rl[2] != "HTTP/1.1" && rl[2] != "HTTP/1.0")
                return HttpReq.Fail(rl[2].StartsWith("HTTP/") ? 505 : 400, "HTTP version " + Logic.Clip(rl[2], 12));
            if (rl[1][0] != '/') return HttpReq.Fail(400, "the target isn't a path");
            var r = new HttpReq { Method = rl[0], Target = rl[1], Version = rl[2] };
            int q = r.Target.IndexOfAny(new[] { '?', '#' });
            r.Path = q < 0 ? r.Target : r.Target.Substring(0, q);
            if (lines.Length - 1 > MaxHeaders) return HttpReq.Fail(431, "over " + MaxHeaders + " headers");
            for (int i = 1; i < lines.Length; i++)
            {
                string line = lines[i];
                if (line.Length == 0 || line[0] == ' ' || line[0] == '\t') return HttpReq.Fail(400, "a folded or empty header line");
                int colon = line.IndexOf(':');
                if (colon <= 0) return HttpReq.Fail(400, "a header without a name and colon");
                string name = line.Substring(0, colon), value = line.Substring(colon + 1).Trim(' ', '\t');
                if (!IsToken(name)) return HttpReq.Fail(400, "a bad header name");
                if (r.Headers.ContainsKey(name))
                {
                    if (Single.Contains(name)) return HttpReq.Fail(400, "a second " + name + " header");
                    r.Headers[name] = r.Headers[name] + ", " + value;
                }
                else r.Headers[name] = value;
            }
            if (r.Header("Transfer-Encoding") != null) return HttpReq.Fail(501, "Transfer-Encoding isn't supported");
            if (r.Version == "HTTP/1.1" && r.Header("Host") == null) return HttpReq.Fail(400, "no Host header");
            string cl = r.Header("Content-Length");
            if (cl != null)
            {
                if (cl.Length == 0 || cl.Length > 9 || cl.Any(ch => ch < '0' || ch > '9')) return HttpReq.Fail(400, "a bad Content-Length");
                int len = int.Parse(cl, NumberStyles.None, CultureInfo.InvariantCulture);
                if (len > maxBody) return HttpReq.Fail(413, "the body is over " + maxBody + " bytes");
                r.ContentLength = len;
            }
            return r;
        }

        static bool IsToken(string s)
        {
            if (string.IsNullOrEmpty(s)) return false;
            foreach (char ch in s)
                if (!((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || "!#$%&'*+-.^_`|~".IndexOf(ch) >= 0)) return false;
            return true;
        }

        static string Reason(int status)
        {
            switch (status)
            {
                case 200: return "OK";
                case 400: return "Bad Request";
                case 403: return "Forbidden";
                case 404: return "Not Found";
                case 405: return "Method Not Allowed";
                case 408: return "Request Timeout";
                case 413: return "Payload Too Large";
                case 415: return "Unsupported Media Type";
                case 431: return "Request Header Fields Too Large";
                case 501: return "Not Implemented";
                case 505: return "HTTP Version Not Supported";
                default: return "Error";
            }
        }

        public static byte[] Write(HttpResp r)
        {
            var body = new UTF8Encoding(false).GetBytes(r.Body);
            var sb = new StringBuilder();
            sb.Append("HTTP/1.1 ").Append(r.Status).Append(' ').Append(Reason(r.Status)).Append("\r\n");
            sb.Append("Content-Type: ").Append(r.Type).Append("\r\n");
            sb.Append("Content-Length: ").Append(body.Length).Append("\r\n");
            sb.Append("Connection: close\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: DENY\r\nReferrer-Policy: no-referrer\r\n");
            if (r.Csp != null) sb.Append("Content-Security-Policy: ").Append(r.Csp).Append("\r\n");
            sb.Append("\r\n");
            var head = Encoding.ASCII.GetBytes(sb.ToString());
            var all = new byte[head.Length + body.Length];
            Buffer.BlockCopy(head, 0, all, 0, head.Length);
            Buffer.BlockCopy(body, 0, all, head.Length, body.Length);
            return all;
        }
    }

    public class ActResult
    {
        public bool Known = true, Ok, NeedConfirm; public string Message;
        public Dictionary<string, object> ToJson()
        {
            return new Dictionary<string, object> { { "ok", Ok }, { "message", Message }, { "needConfirm", NeedConfirm } };
        }
    }

    public class WebUi
    {
        public const int DefaultPort = 48790;
        public const string TokenHeader = "X-MTG-Token";
        const int MaxOpen = 16;      // connections at once; a new one past this closes the oldest still waiting for its request
        const int IdleSec = 20;      // no page polling for this long: the watcher slows down as for a hidden window
        const int ReadTimeoutMs = 5000, RequestDeadlineSec = 10; // (a silent socket; a request trickling in)

        readonly Controller c;
        public readonly string Token = NewToken();
        public int Port;             // the port in use (Start sets it; tests set it by hand)
        public bool Managing;        // the page replaces the window: it keeps Controller.WindowVisible current
        TcpListener listener;
        Thread thread;
        System.Threading.Timer idle;
        volatile bool stopping;
        long lastPoll; // (UTC ticks of the last /api/status)

        // the open connections, oldest first; Reading: still waiting for its request (these are the ones dropped)
        class Conn { public TcpClient Client; public volatile bool Reading = true; }
        readonly List<Conn> conns = new List<Conn>();
        readonly object connGate = new object();

        // the actions: one at a time, and the last one accepted (a second press of it while it runs is a no-op)
        readonly object actGate = new object();
        string lastAccepted;

        // the effects that don't go through the Controller (tests replace them)
        public Action<string> OpenFolder = dir => { Directory.CreateDirectory(dir); Release(Process.Start("explorer.exe", "\"" + dir + "\"")); };
        public Action<string, string> StartProgram = (exe, args) => { Release(Process.Start(exe, args)); };

        // (Process.Start gives null when the shell hands the job to a program that is already running, e.g. the browser)
        static void Release(Process p) { if (p != null) p.Dispose(); }
        public string WslFile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".wslconfig");

        public WebUi(Controller controller) { c = controller; }

        public string Url { get { return "http://127.0.0.1:" + Port + "/"; } }
        public IPAddress BoundTo { get { return listener == null ? null : ((IPEndPoint)listener.LocalEndpoint).Address; } }

        static string NewToken()
        {
            var b = new byte[16];
            using (var rng = new RNGCryptoServiceProvider()) rng.GetBytes(b);
            return BitConverter.ToString(b).Replace("-", "").ToLowerInvariant();
        }

        // ───────────────────────────── Program's hook ─────────────────────────────

        // The page instead of the window. null: keep the window as before (--no-web, --shot, or no port could be opened).
        //   --web-port N   another port (0: any free one); --no-browser   never open the browser by itself (tests)
        public static WebUi Launch(Controller c, StatusForm form, string[] args)
        {
            return Launch(c, args, w =>
            {
                var handle = form.Handle; // (the window's handle without showing it: its tray icon, timer and balloons run as before)
                form.OpenStatus = w.OpenBrowser;
            }, () => { form.Show(); c.WindowVisible = true; }, a => { try { form.BeginInvoke(a); } catch { } }, null, 500);
        }

        // (the same without a window, for --selftest: hook runs before the auto-open; open: null for the real browser)
        public static WebUi Launch(Controller c, string[] args, Action<WebUi> hook, Action showWindow, Action<Action> onUi, Func<bool> open, int pollMs)
        {
            if (args.Contains("--no-web") || args.Contains("--shot")) return null;
            int port = DefaultPort, n;
            string p = Program.Arg(args, "--web-port");
            if (p != null && int.TryParse(p, NumberStyles.None, CultureInfo.InvariantCulture, out n) && n < 65536) port = n;
            var w = new WebUi(c);
            if (!w.Start(port)) return null;
            w.Managing = true;
            hook(w);
            w.AutoOpened = AutoOpen(c, args.Contains("--no-browser"), open ?? new Func<bool>(w.OpenBrowser), showWindow, onUi, pollMs);
            return w;
        }

        public string AutoOpened; // what AutoOpen did at start (for --selftest)

        // Opening the page by itself at start. open: the browser (false when none opened); showWindow: the fallback;
        // onUi: runs on the window's thread. Returns what it did: "off" (--no-browser), "first" (the first start of the
        // package: opened, flag written), "window" (that first open failed: the window instead, flag not written, so
        // the next start tries again), "watching" (later starts: opens once the first pass ends, if a light is red).
        public static string AutoOpen(Controller c, bool noBrowser, Func<bool> open, Action showWindow, Action<Action> onUi, int pollMs)
        {
            if (noBrowser) return "off";
            if (OpenAtStart(c.L.Friend, c.Observe, c.StatusPageShownBefore()))
            {
                if (!open()) { showWindow(); return "window"; }
                c.MarkStatusPageShown();
                return "first";
            }
            var t = new Thread(() =>
            {
                var until = DateTime.UtcNow.AddMinutes(10);
                while (!c.FirstPassDone && DateTime.UtcNow < until) Thread.Sleep(pollMs);
                if (c.FirstPassDone && OpenAfterFirstPass(c.Observe, c.Rows.Select(r => r.V.Light)))
                    onUi(() => { if (!open()) showWindow(); });
            });
            t.IsBackground = true;
            t.Start();
            return "watching";
        }

        // a tray click and the double-click that follows it open the page once
        public static bool ClickAllowed(DateTime last, DateTime now, int windowMs) { return (now - last).TotalMilliseconds >= windowMs; }

        // the first start ever of a package opens the page once by itself
        public static bool OpenAtStart(bool friend, bool observe, bool shownBefore) { return friend && !observe && !shownBefore; }

        // every later start (and home mode) opens it only when the first pass ends with a red light
        public static bool OpenAfterFirstPass(bool observe, IEnumerable<Light> lights) { return !observe && lights.Any(l => l == Light.Red); }

        // false when no browser could be started (the window shows instead)
        public bool OpenBrowser()
        {
            try
            {
                Release(Process.Start(new ProcessStartInfo(Url) { UseShellExecute = true }));
                Log.Write("status page opened in the browser: " + Url);
                return true;
            }
            catch (Exception e) { Log.Write("status page: the browser didn't open (" + e.Message + "); showing the window"); return false; }
        }

        // ───────────────────────────── the server ─────────────────────────────

        // Listens on 127.0.0.1:port, else on any free port. false when neither works.
        public bool Start(int port)
        {
            foreach (int p in port == 0 ? new[] { 0 } : new[] { port, 0 })
            {
                try
                {
                    var l = new TcpListener(IPAddress.Loopback, p);
                    l.ExclusiveAddressUse = true; // (no other program can bind the same port beside us)
                    l.Start(MaxOpen);
                    listener = l;
                    Port = ((IPEndPoint)l.LocalEndpoint).Port;
                    break;
                }
                catch (SocketException e) { Log.Write("status page: port " + p + " isn't free (" + e.SocketErrorCode + ")"); }
            }
            if (listener == null) return false;
            thread = new Thread(Accept);
            thread.IsBackground = true;
            thread.Name = "status page";
            thread.Start();
            idle = new System.Threading.Timer(_ => IdleCheck(), null, 5000, 5000);
            Log.Write("status page: " + Url);
            return true;
        }

        public void Stop()
        {
            stopping = true;
            if (idle != null) idle.Dispose();
            try { if (listener != null) listener.Stop(); } catch { }
        }

        void Accept()
        {
            while (!stopping)
            {
                TcpClient client;
                try { client = listener.AcceptTcpClient(); }
                catch { if (stopping) return; Thread.Sleep(200); continue; }
                var conn = new Conn { Client = client };
                Conn drop = null;
                lock (connGate)
                {
                    if (conns.Count >= MaxOpen)
                    {
                        // full: idle sockets (a browser's spare connections, or a stuck client) must not lock the page out
                        int i = OldestWaiting(conns.Select(x => x.Reading).ToList());
                        if (i < 0) { try { client.Close(); } catch { } continue; }
                        drop = conns[i];
                        conns.RemoveAt(i);
                    }
                    conns.Add(conn);
                }
                if (drop != null) try { drop.Client.Close(); } catch { }
                // (its own thread, not the thread pool: the probes' process reads use the pool and may be slow to free it)
                var t = new Thread(() => { try { Serve(conn); } finally { lock (connGate) conns.Remove(conn); } });
                t.IsBackground = true;
                t.Start();
            }
        }

        // the connection to drop when full: the oldest one still waiting for its request; -1 when all are being answered
        public static int OldestWaiting(IList<bool> reading)
        {
            for (int i = 0; i < reading.Count; i++) if (reading[i]) return i;
            return -1;
        }

        void Serve(Conn conn)
        {
            var client = conn.Client;
            try
            {
                using (client)
                {
                    client.ReceiveTimeout = ReadTimeoutMs; client.SendTimeout = 5000; client.NoDelay = true;
                    var s = client.GetStream();
                    var req = MiniHttp.Read(s, MiniHttp.MaxHead, MiniHttp.MaxBody, DateTime.UtcNow.AddSeconds(RequestDeadlineSec));
                    conn.Reading = false;
                    if (req == null) return;
                    var b = MiniHttp.Write(Handle(req));
                    s.Write(b, 0, b.Length);
                    s.Flush();
                    // (a refused request may still be sending its body: read a little of it, so closing doesn't reset the
                    // connection before the answer arrives)
                    client.Client.Shutdown(SocketShutdown.Send);
                    client.ReceiveTimeout = 1000;
                    var junk = new byte[4096];
                    var until = DateTime.UtcNow.AddSeconds(1);
                    try { while (DateTime.UtcNow < until && s.Read(junk, 0, junk.Length) > 0) { } } catch { }
                }
            }
            catch (Exception e) { if (!(e is IOException) && !(e is SocketException) && !(e is ObjectDisposedException)) Log.Write("status page: " + e); }
        }

        void IdleCheck() { IdleCheck(DateTime.UtcNow); }

        // no page has polled for IdleSec: the watcher slows down as for a hidden window
        public void IdleCheck(DateTime nowUtc)
        {
            if (Managing && (nowUtc - new DateTime(Interlocked.Read(ref lastPoll), DateTimeKind.Utc)).TotalSeconds > IdleSec)
                c.WindowVisible = false;
        }

        void Polled()
        {
            Interlocked.Exchange(ref lastPoll, DateTime.UtcNow.Ticks);
            if (Managing && !c.WindowVisible) { c.WindowVisible = true; c.Nudge(); } // (a page came back: fresh lights now)
        }

        // ───────────────────────────── guards and routes ─────────────────────────────

        public bool HostOk(string host)
        {
            return host != null && (string.Equals(host, "127.0.0.1:" + Port, StringComparison.OrdinalIgnoreCase)
                || string.Equals(host, "localhost:" + Port, StringComparison.OrdinalIgnoreCase));
        }

        public bool OriginOk(string origin)
        {
            return string.Equals(origin, "http://127.0.0.1:" + Port, StringComparison.OrdinalIgnoreCase)
                || string.Equals(origin, "http://localhost:" + Port, StringComparison.OrdinalIgnoreCase);
        }

        // constant time: the answer's timing doesn't tell how much of a guess was right
        public bool TokenOk(string t)
        {
            if (t == null || t.Length != Token.Length) return false;
            int d = 0;
            for (int i = 0; i < t.Length; i++) d |= t[i] ^ Token[i];
            return d == 0;
        }

        // exactly application/json, with at most a charset=utf-8 parameter
        public static bool JsonType(string ct)
        {
            if (ct == null) return false;
            var parts = ct.Split(';');
            if (parts.Length > 2 || !string.Equals(parts[0].Trim(), "application/json", StringComparison.OrdinalIgnoreCase)) return false;
            if (parts.Length == 1) return true;
            string p = parts[1].Trim().Replace("\"", "");
            return string.Equals(p, "charset=utf-8", StringComparison.OrdinalIgnoreCase);
        }

        static HttpResp Refuse(int status, string error, string message)
        {
            return new HttpResp(status, J.Write(new Dictionary<string, object> { { "error", error }, { "message", message } }));
        }

        public HttpResp Handle(HttpReq r)
        {
            try
            {
                if (r.Error != 0) return Refuse(r.Error, "bad-request", r.Why);
                if (!HostOk(r.Header("Host"))) return Refuse(403, "bad-host", "Open the page at " + Url);
                string origin = r.Header("Origin");
                if (origin != null && !OriginOk(origin)) return Refuse(403, "bad-origin", "Requests from other sites are refused.");
                if (r.Path.StartsWith("/api/"))
                {
                    string site = r.Header("Sec-Fetch-Site");
                    if (site != null && site != "same-origin" && site != "none") return Refuse(403, "cross-site", "Requests from other sites are refused.");
                    if (!TokenOk(r.Header(TokenHeader))) return Refuse(403, "bad-token", "This page is from an earlier run of the companion: reload it.");
                }
                switch (r.Path)
                {
                    case "/":
                    case "/index.html":
                        return r.Method == "GET" ? Page() : Refuse(405, "method", "GET only.");
                    case "/api/status":
                        if (r.Method != "GET") return Refuse(405, "method", "GET only.");
                        Polled();
                        return new HttpResp(200, J.Write(Status()));
                    case "/api/action":
                        if (r.Method != "POST") return Refuse(405, "method", "POST only.");
                        if (!JsonType(r.Header("Content-Type"))) return Refuse(415, "content-type", "Send application/json.");
                        var body = J.Parse(r.Body) as Dictionary<string, object>;
                        string id = J.Str(body, "id");
                        if (string.IsNullOrEmpty(id)) return Refuse(400, "bad-body", "Send {\"id\": \"...\"}.");
                        var res = Act(id, J.Bool(body, "confirmLocked"));
                        return new HttpResp(res.Known ? 200 : 400, J.Write(res.ToJson()));
                    case "/api/tools":
                        return Tools(r);
                    default:
                        return Refuse(404, "not-found", "Nothing here.");
                }
            }
            catch (Exception e)
            {
                Log.Write("status page: " + r.Method + " " + r.Path + " failed: " + e);
                return Refuse(500, "error", "The companion hit an error; the log has it.");
            }
        }

        HttpResp Page()
        {
            string nonce = NewToken();
            return new HttpResp(200, WebPage.Html.Replace("{{TOKEN}}", Token).Replace("{{NONCE}}", nonce))
            {
                Type = "text/html; charset=utf-8",
                Csp = "default-src 'none'; script-src 'nonce-" + nonce + "'; style-src 'nonce-" + nonce + "'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
            };
        }

        // ───────────────────────────── the JSON ─────────────────────────────

        public static string State(Light l)
        {
            switch (l)
            {
                case Light.Green: return "green";
                case Light.Red: return "red";
                case Light.Amber:
                case Light.Busy: return "amber";
                default: return "grey";
            }
        }

        static string Kind(Game g)
        {
            return g == null ? "cantTell" : g.Kind == GameKind.None ? "none" : g.Kind == GameKind.On ? "on" : "cantTell";
        }

        // the row's button as the window shows it: a fix on an amber or red light, never in observe mode
        bool ShowsFix(Verdict v) { return v.Fix != null && (v.Light == Light.Red || v.Light == Light.Amber) && !c.Observe; }

        static string Confirm(Verdict v)
        {
            switch (v.Fix)
            {
                case Fixes.StackRestart: return "Restart the relay and the Forge room (about 20 s)?";
                case Fixes.BridgeRestart: return "Restart the bridge (a few seconds)? TTS will redraw the table.";
                case Fixes.ImagesLoad: return "Load the engine images from the package again (a few minutes)?";
                case Fixes.ShowProgram: return v.Text + "\n\nTask Manager opens next: find the program on the Details tab (the process number is in the sentence above) and close it yourself. The Bridge step then runs again.";
                default: return null;
            }
        }

        object LightAction(int row, Verdict v, Game g, bool locked)
        {
            if (!ShowsFix(v)) return null;
            bool lockedFix = Fixes.LocksDuringGame(v.Fix) && locked;
            return new Dictionary<string, object>
            {
                { "id", "fix:" + row + ":" + v.Fix }, { "label", v.FixLabel }, { "locked", lockedFix },
                { "lockText", lockedFix ? Logic.LockText(g) : null }, { "confirm", Confirm(v) },
            };
        }

        string Headline(Light worst, Game g)
        {
            var red = c.Rows.FirstOrDefault(r => r.V.Light == Light.Red);
            if (red != null) return "Problem: " + red.Name;
            switch (worst)
            {
                case Light.Busy: return c.Phase;
                case Light.Amber: return c.Rows.Count(r => r.V.Light == Light.Amber) + " to check";
                case Light.Grey: return "Stopped";
                default: return g != null && g.Kind == GameKind.On ? "Ready: game on" : "Ready";
            }
        }

        string WslConfirm()
        {
            string now = Probes.ReadText(WslFile);
            return "Optional. Docker runs the engine in a Linux VM (WSL) that may use every CPU core, and Tabletop Simulator then has to share them. On a PC with 4–8 cores, giving Docker only 2 cores keeps TTS smoother; the engine thinks a little slower.\n\n"
                + "This writes processors=2 and memory=8GB into the [wsl2] section of " + WslFile + " (other lines are kept; a copy of the old file is saved beside it). It affects every WSL program on this PC, not only Docker, and takes effect the next time WSL restarts. Nothing restarts now.\n\n"
                + "Current file: " + (now == null ? "none" : Logic.Clip(now.Trim(), 400)) + "\n\nWrite the limit?";
        }

        List<object> Menu(bool locked, Game g)
        {
            return new List<object>
            {
                new Dictionary<string, object>
                {
                    { "id", "restart-engine" }, { "label", Logic.RestartLabel(g) }, { "enabled", !locked && !c.Observe },
                    { "title", c.Observe ? ObserveText : locked ? Logic.LockText(g) : "Stops the bridge, restarts relay and room, then starts the bridge again." },
                    { "confirm", "Restart the engine? This stops the bridge, restarts the relay and the Forge room, and starts the bridge again (under a minute)." }, { "confirmLocked", false },
                },
                new Dictionary<string, object>
                {
                    { "id", "stop-everything" }, { "label", "Stop everything" }, { "enabled", !c.Observe },
                    { "title", c.Observe ? ObserveText : "Stops the bridge and the engine containers; Docker Desktop and TTS keep running." },
                    { "confirm", locked ? g.Text + "\n\nStopping everything ends that game for everyone. Stop anyway?" : "Stop the bridge and the engine containers? Docker Desktop and TTS keep running." },
                    { "confirmLocked", locked },
                },
                new Dictionary<string, object>
                {
                    { "id", "open-logs" }, { "label", "Open logs folder" }, { "enabled", true }, { "title", c.L.LogsDir }, { "confirm", null }, { "confirmLocked", false },
                },
                new Dictionary<string, object>
                {
                    { "id", "wsl-limits" }, { "label", "Limit Docker's CPU use…" }, { "enabled", !c.Observe },
                    { "title", c.Observe ? ObserveText : "Optional: gives Docker 2 cores so TTS runs smoother." }, { "confirm", c.Observe ? null : WslConfirm() }, { "confirmLocked", false },
                },
            };
        }

        static List<string> LogTail(int lines)
        {
            var t = Log.File == null ? null : Probes.Tail(Log.File, 16000);
            if (t == null) return new List<string>();
            var all = t.Replace("\r", "").Split('\n').ToList();
            if (t.Length >= 15000 && all.Count > 1) all.RemoveAt(0); // (the first line was cut)
            return all.Where(s => s.Length > 0).Reverse().Take(lines).Reverse().ToList();
        }

        public Dictionary<string, object> Status()
        {
            var g = c.Game;
            bool locked = c.IsLocked;
            var lights = new List<object>();
            for (int i = 0; i < c.Rows.Length; i++)
            {
                var row = c.Rows[i];
                var v = row.V;
                lights.Add(new Dictionary<string, object>
                {
                    { "step", i + 1 }, { "name", row.Name }, { "state", State(v.Light) }, { "busy", v.Light == Light.Busy },
                    { "word", Icons.Word(v.Light) }, { "text", v.Text }, { "hint", v.Hint },
                    { "at", row.At == DateTime.MinValue ? null : row.At.ToString("HH:mm:ss") }, { "action", LightAction(i, v, g, locked) },
                });
            }
            var worst = Logic.Worst(c.Rows.Select(r => r.V.Light));
            string hint = c.Rows.Select(r => r.V).Where(v => v.Hint != null && v.Light != Light.Green && v.Light != Light.Grey).Select(v => v.Hint).FirstOrDefault()
                ?? Logic.TtsHowTo(c.SaveName) + "\n\nOnly the host runs this app. Friends join your TTS game (Multiplayer) and need nothing else.";
            return new Dictionary<string, object>
            {
                { "api", 1 }, { "app", "MTG Companion" }, { "at", DateTime.Now.ToString("HH:mm:ss") },
                { "mode", c.L.Friend ? "friend" : "home" }, { "home", c.L.Home }, { "observe", c.Observe }, { "phase", c.Phase },
                { "worst", new Dictionary<string, object> { { "state", State(worst) }, { "busy", worst == Light.Busy }, { "text", Headline(worst, g) } } },
                { "game", new Dictionary<string, object>
                    {
                        { "kind", Kind(g) }, { "text", g == null ? "" : g.Text }, { "turn", g == null ? 0 : g.Turn },
                        { "locked", locked }, { "lockText", locked ? Logic.LockText(g) : null },
                    } },
                { "lights", lights },
                { "menu", Menu(locked, g) },
                { "hint", hint },
                { "versions", new Dictionary<string, object>
                    {
                        { "text", c.VersionText }, { "companion", typeof(WebUi).Assembly.GetName().Version.ToString() },
                        { "table", c.Want("table") }, { "bridge", c.Want("bridge") }, { "save", c.SaveName },
                    } },
                { "log", new Dictionary<string, object> { { "file", Log.File }, { "lines", LogTail(60) } } },
                { "update", UpdateSection(c.Update, c.L.Friend, c.Observe) },
            };
        }

        // ───────────────────────────── the update section ─────────────────────────────

        static bool UpdateWorking(string status) { return status == "checking" || status == "downloading" || status == "installing" || status == "restarting"; }

        public static string UpdateTitle(UpdateState u)
        {
            switch (u.Status)
            {
                case "available": return "Update available: " + u.Available;
                case "downloading": return "Downloading update" + (u.Progress >= 0 ? " (" + u.Progress + "%)" : "");
                case "ready": return "Update ready: installs after the game";
                case "installing": return "Installing update";
                case "restarting": return "Restarting with the new version";
                case "updated": return "Updated";
                case "failed": return "Update problem";
                case "interrupted": return "An update was interrupted";
                case "checking": return "Checking for updates";
                default: return "Updates";
            }
        }

        static Dictionary<string, object> UpdateButton(string id, string label, bool enabled, string title, string confirm)
        {
            return new Dictionary<string, object> { { "id", id }, { "label", label }, { "enabled", enabled }, { "title", title }, { "confirm", confirm }, { "confirmLocked", false } };
        }

        // the `update` field: friend mode only (home mode updates with git; observe changes nothing)
        public static Dictionary<string, object> UpdateSection(UpdateState u, bool friend, bool observe)
        {
            if (!friend || observe || u == null) return null;
            bool working = UpdateWorking(u.Status);
            bool offered = u.Available != null && (u.Status == "available" || u.Status == "failed");
            var actions = new List<object>();
            if (offered)
            {
                actions.Add(UpdateButton("update-now", "Update now", !working, u.Notes ?? "Downloads and installs " + u.Available + ".",
                    "Install update " + u.Available + " now?\n\n" + (u.Notes ?? "") + "\n\nThe bridge stops for a minute while it installs. During a game it only downloads, and installs 2 minutes after the game."));
                if (u.Status == "available" && !u.Later) actions.Add(UpdateButton("update-later", "Later", true, "No reminder for this update until you check again.", null));
            }
            actions.Add(UpdateButton("update-check", u.Status == "checking" ? "Checking…" : "Check for updates", !working, u.LastCheck != null ? "Last checked " + u.LastCheck : "Not checked yet.", null));
            string line = u.Text;
            if (string.IsNullOrEmpty(line)) line = "This package: " + (u.Current ?? "?") + ".";
            return new Dictionary<string, object>
            {
                { "title", UpdateTitle(u) }, { "line", line }, { "status", u.Status }, { "current", u.Current }, { "available", u.Available },
                { "progress", u.Progress }, { "deferred", u.DeferredUntilGameEnds }, { "error", u.Error }, { "lastCheck", u.LastCheck }, { "actions", actions },
            };
        }

        // ───────────────────────────── actions ─────────────────────────────

        static ActResult Done(string m) { return new ActResult { Ok = true, Message = m }; }
        static ActResult No(string m) { return new ActResult { Ok = false, Message = m }; }
        const string ObserveText = "Observe mode: nothing is changed.";

        // The window's buttons and menu, by id. Every change goes through the same Controller call as the window, so the
        // game lock (and observe mode) refuse here exactly as there.
        // A second press of the action last accepted, while the Controller still runs it (queued, or its start sequence
        // going), is a no-op: a double click must not restart twice. Actions run one at a time.
        public ActResult Act(string id, bool confirmLocked)
        {
            lock (actGate)
            {
                var res = Route(id, confirmLocked);
                if (res.Known) // (only a known id is written to the log)
                    Log.Write("status page: " + id + (confirmLocked ? " (confirmed during a game)" : "") + ": " + (res.Ok ? "" : "refused: ") + Logic.Clip(res.Message, 120));
                return res;
            }
        }

        bool Repeat(string id) { return id == lastAccepted && c.WorkPending; }
        static ActResult Already() { return Done("Already running; the lights show how far it is."); }

        ActResult Route(string id, bool confirmLocked)
        {
            if (id.StartsWith("fix:")) return Fix(id);
            switch (id)
            {
                case "restart-engine":
                {
                    if (!c.Observe && Repeat(id)) return Already();
                    var refused = c.RestartEngine();
                    if (refused != null) return No(refused);
                    lastAccepted = id;
                    return Done("Restarting the engine: the lights show each step.");
                }
                case "stop-everything":
                    if (c.Observe) return No(ObserveText);
                    if (Repeat(id)) return Already();
                    if (c.IsLocked && !confirmLocked)
                        return new ActResult { Ok = false, NeedConfirm = true, Message = c.Game.Text + "\n\nStopping everything ends that game for everyone." };
                    c.StopEverything(null);
                    lastAccepted = id;
                    return Done("Stopping the bridge and the engine containers.");
                case "open-logs":
                    try { OpenFolder(c.L.LogsDir); return Done("Opened " + c.L.LogsDir + "."); }
                    catch (Exception e) { return No("Couldn't open the logs folder: " + e.Message); }
                case "wsl-limits":
                    return Wsl();
                case "update-check":
                {
                    if (c.Observe) return No(ObserveText);
                    if (Repeat(id) || (lastAccepted == id && c.UpdateBusy)) return Already();
                    var why = c.CheckNow();
                    if (why != null) return No(why);
                    lastAccepted = id;
                    return Done("Checking for updates.");
                }
                case "update-now":
                {
                    if (c.Observe) return No(ObserveText);
                    if (lastAccepted == id && c.UpdateBusy) return Already();
                    var why = c.UpdateNow();
                    if (why != null) return No(why);
                    lastAccepted = id;
                    return Done("Downloading the update; the update section shows how far it is (it installs when no game is on).");
                }
                case "update-later":
                {
                    if (c.Observe) return No(ObserveText);
                    var why = c.Later();
                    return why != null ? No(why) : Done("Later: no reminder for this update until you check again.");
                }
            }
            return new ActResult { Known = false, Message = "Unknown action." };
        }

        ActResult Fix(string id)
        {
            var p = id.Split(':');
            int row;
            if (p.Length != 3 || !int.TryParse(p[1], NumberStyles.None, CultureInfo.InvariantCulture, out row) || row >= c.Rows.Length)
                return new ActResult { Known = false, Message = "Unknown action." };
            if (c.Observe) return No(ObserveText);
            var v = c.Rows[row].V;
            if (!ShowsFix(v)) return No("That light has no button now.");
            if (v.Fix != p[2]) return No("That button has changed; the page now shows the current one.");
            if (Repeat(id)) return Already();
            if (v.Fix == Fixes.ShowProgram)
            {
                try { StartProgram("taskmgr.exe", "/0 /startup"); } catch { }
                c.DoFix(Controller.StepBridge, Fixes.Retry);
                lastAccepted = id;
                return Done("Task Manager is open: close the program named on the Bridge row. The Bridge step runs again.");
            }
            var refused = c.DoFix(row, v.Fix);
            if (refused != null) return No(refused);
            lastAccepted = id;
            return Done(v.FixLabel + ": started.");
        }

        // ───────────────────────────── table tools ─────────────────────────────
        // The bridge's own AI seats and debug tools (bridge GET/POST /tools; docs/next-features-2026-11-09.md items 17,
        // 18, 20, 21), passed through: GET /api/tools is the bridge's state, POST /api/tools one change, answered
        // {ok, message}. Only a body of a known kind is passed on, rewritten from what was parsed; observe mode refuses
        // every POST. The page is the host's (it opens only on this PC, with this run's token), which is what "host only"
        // means here; the bridge itself refuses a debug tool while debug tools are off.
        public static readonly string[] ToolKinds = { "ai-seat", "debug-mode", "debug" };
        // (method, path on the bridge, JSON body or null) -> the bridge's answer; tests replace it
        public Func<string, string, string, HttpResult> BridgeCall = (method, path, json) =>
            method == "GET" ? Probes.HttpGet(Controller.BridgeUrl + path, 5000) : Probes.HttpPost(Controller.BridgeUrl + path, json, 10000);

        HttpResp Tools(HttpReq r)
        {
            if (r.Method == "GET")
            {
                var got = BridgeCall("GET", "/tools", null);
                if (got.Kind != HttpKind.Ok || got.Status != 200 || !(J.Parse(got.Body) is Dictionary<string, object>))
                    return Refuse(502, "no-bridge", NoBridge(got));
                return new HttpResp(200, got.Body);
            }
            if (r.Method != "POST") return Refuse(405, "method", "GET or POST only.");
            if (!JsonType(r.Header("Content-Type"))) return Refuse(415, "content-type", "Send application/json.");
            var body = J.Parse(r.Body) as Dictionary<string, object>;
            string kind = J.Str(body, "kind");
            if (body == null || !ToolKinds.Contains(kind)) return Refuse(400, "bad-body", "Send {\"kind\": \"ai-seat\" | \"debug-mode\" | \"debug\", ...}.");
            if (c.Observe) return new HttpResp(200, J.Write(new Dictionary<string, object> { { "ok", false }, { "message", ObserveText } }));
            var sent = J.Write(body);
            var res = BridgeCall("POST", "/tools", sent);
            var answer = res.Kind == HttpKind.Ok ? J.Parse(res.Body) as Dictionary<string, object> : null;
            if (answer == null) return Refuse(502, "no-bridge", NoBridge(res));
            Log.Write("status page: tools " + kind + ": " + (J.Bool(answer, "ok") ? "" : "refused: ") + Logic.Clip(J.Str(answer, "message") ?? "", 120));
            return new HttpResp(200, J.Write(new Dictionary<string, object> { { "ok", J.Bool(answer, "ok") }, { "message", J.Str(answer, "message") ?? "" } }));
        }

        static string NoBridge(HttpResult h)
        {
            return h.Kind == HttpKind.Refused ? "The bridge isn't running: start the engine first (the Bridge light)."
                : h.Kind == HttpKind.Timeout ? "The bridge didn't answer in time."
                : h.Kind == HttpKind.Ok && h.Status == 404 ? "This bridge has no table tools yet: restart the engine to run the new one."
                : "The bridge couldn't be asked (" + (h.Error ?? ("HTTP " + h.Status)) + ").";
        }

        ActResult Wsl()
        {
            if (c.Observe) return No(ObserveText);
            try
            {
                string now = Probes.ReadText(WslFile);
                if (now != null) File.Copy(WslFile, WslFile + ".bak-" + DateTime.Now.ToString("yyyyMMdd-HHmm"), true);
                File.WriteAllText(WslFile, Logic.SetWslLimits(now, 2, "8GB"));
                Log.Write("wrote " + WslFile + " (processors=2, memory=8GB), on a status-page click");
                return Done("Saved. It takes effect after WSL restarts (restart the PC, or quit Docker Desktop and run \"wsl --shutdown\" yourself).");
            }
            catch (Exception e) { return No("Couldn't write it: " + e.Message); }
        }
    }

    // The Controller's side of the page: the state.json flag and a wake-up (here, so Controller.cs only says "partial")
    public partial class Controller
    {
        public bool StatusPageShownBefore() { return J.Bool(StateDict(), "statusPageShown"); }

        // (called before Start(): the worker isn't writing state.json yet)
        public void MarkStatusPageShown()
        {
            try { var d = StateDict(); d["statusPageShown"] = true; WriteState(d); }
            catch (Exception e) { Log.Write("state.json: the status page flag wasn't written (" + e.Message + ")"); }
        }

        // the watcher checks again now instead of after its wait
        public void Nudge() { wake.Set(); }

        // a button's work is still going: queued, about to start the sequence, or the sequence/stop running
        public bool WorkPending
        {
            get
            {
                lock (q) if (work.Count > 0) return true;
                var p = Phase ?? "";
                return pendingFrom > 0 || p.StartsWith("Starting") || p.StartsWith("Restarting") || p.StartsWith("Stopping");
            }
        }

        public int QueuedWork { get { lock (q) return work.Count; } } // (for --selftest)
    }
}
