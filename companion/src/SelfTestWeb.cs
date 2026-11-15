// --selftest, the status page (WebUi.cs): the HTTP parser, the guards, the JSON shape and the routing of the buttons
// through the Controller's game lock. Nothing here opens a browser, a folder or a program (the effects are swapped),
// and the Controllers' workers never start, so an action that isn't refused only lands in a queue nobody reads.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace MtgCompanion
{
    public static partial class SelfTest
    {
        static HttpReq Req(string raw)
        {
            return MiniHttp.Read(new MemoryStream(Encoding.ASCII.GetBytes(raw)), MiniHttp.MaxHead, MiniHttp.MaxBody, DateTime.UtcNow.AddMinutes(1));
        }

        static HttpReq ReqBytes(byte[] raw)
        {
            return MiniHttp.Read(new MemoryStream(raw), MiniHttp.MaxHead, MiniHttp.MaxBody, DateTime.UtcNow.AddMinutes(1));
        }

        static int ErrOf(string raw) { var r = Req(raw); return r == null ? -1 : r.Error; }

        // a request as the page sends it
        static string Get(WebUi w, string path, string token, string extra = "")
        {
            return "GET " + path + " HTTP/1.1\r\nHost: 127.0.0.1:" + w.Port + "\r\n" + (token != null ? WebUi.TokenHeader + ": " + token + "\r\n" : "") + extra + "\r\n";
        }

        static string Post(WebUi w, string json, string token, string extra = "", string type = "application/json")
        {
            int len = Encoding.UTF8.GetByteCount(json);
            return "POST /api/action HTTP/1.1\r\nHost: 127.0.0.1:" + w.Port + "\r\nOrigin: http://127.0.0.1:" + w.Port + "\r\nContent-Type: " + type + "\r\n"
                + (token != null ? WebUi.TokenHeader + ": " + token + "\r\n" : "") + extra + "Content-Length: " + len + "\r\n\r\n" + json;
        }

        static HttpResp Send(WebUi w, string raw) { return w.Handle(Req(raw)); }

        static string ErrorId(HttpResp r) { return J.Str(J.Parse(r.Body), "error"); }

        static object Act(WebUi w, string id, bool confirmLocked = false)
        {
            var r = Send(w, Post(w, "{\"id\":\"" + id + "\"" + (confirmLocked ? ",\"confirmLocked\":true" : "") + "}", w.Token));
            return J.Parse(r.Body);
        }

        static WebUi Page(Controller c, List<string> effects)
        {
            var w = new WebUi(c) { Port = 48790 };
            w.OpenFolder = d => effects.Add("folder " + d);
            w.StartProgram = (exe, a) => effects.Add("run " + exe);
            w.WslFile = Path.Combine(Path.GetTempPath(), "mtg-companion-selftest-wslconfig-never-written");
            return w;
        }

        // After Stop everything (2026-11-13: the header said "Ready" in green, as Docker's row stays green, and the TTS
        // row said "Stopped." with TTS still open): the header is Stopped, grey, and the TTS row says what TTS is doing.
        // The rows are put back as they were after.
        // Launch only checks (2026-11-14): before Start engine the header says Not started (grey, an amber TTS row
        // aside), the hint says press Start engine unless a red light has its own, Start engine is first and gold, and
        // pressing it queues the start sequence once (a second press while it is queued: Already running).
        static void NotStartedStatus(string tmp)
        {
            try
            {
                var effects = new List<string>();
                var n = new Controller(Layout.Make(Mode.Friend, tmp), false, Path.Combine(tmp, "saves-ns"), Path.Combine(tmp, "state-ns"), "x.exe");
                n.Game = Game.None("No game.");
                var w = Page(n, effects);
                n.Rows[0].V = new Verdict(Light.Grey, "Docker Desktop isn't running. Start engine starts it.");
                n.Rows[5].V = new Verdict(Light.Amber, "Tabletop Simulator isn't running.").WithFix(Fixes.TtsOpen, "Open TTS").WithHint("In TTS: Create");
                Func<Dictionary<string, object>> status = () => J.Parse(Send(w, Get(w, "/api/status", w.Token)).Body) as Dictionary<string, object>;
                var s = status();
                var menu = J.Arr(s, "menu");
                Check("not started: NeedsStart before any start", n.NeedsStart);
                Check("not started: the header says Not started, grey (the amber TTS row doesn't make it amber)", J.Str(J.Get(s, "worst"), "text") == "Not started" && J.Str(J.Get(s, "worst"), "state") == "grey", J.Write(J.Get(s, "worst")));
                Check("not started: What to do next says press Start engine (not the TTS row's hint)", J.Str(s, "hint") == Logic.StartHint && J.Str(s, "hint").Contains("Press Start engine"), J.Str(s, "hint"));
                Check("not started: Start engine first in the menu, enabled, gold (primary)", J.Str(menu[0], "id") == "start-engine" && J.Str(menu[0], "label") == "Start engine" && J.Bool(menu[0], "enabled") && J.Bool(menu[0], "primary") && J.Get(menu[0], "confirm") == null, J.Write(menu[0]));
                n.Rows[0].V = new Verdict(Light.Red, "Install Docker Desktop.").WithFix(Fixes.Retry, "Try again").WithHint("Docker Desktop isn't installed on this PC.");
                s = status();
                Check("not started, a real problem: the red light's hint comes first, the header names it", J.Str(s, "hint") == "Docker Desktop isn't installed on this PC." && J.Str(J.Get(s, "worst"), "text") == "Problem: Docker", J.Str(s, "hint"));
                n.Rows[0].V = new Verdict(Light.Grey, "Docker Desktop isn't running. Start engine starts it.");
                var res = Act(w, "start-engine");
                Check("Start engine: accepted, one action queued, nothing run on this thread", J.Bool(res, "ok") && J.Str(res, "message").StartsWith("Starting the engine") && n.QueuedWork == 1, J.Write(res));
                res = Act(w, "start-engine");
                Check("Start engine twice while queued: Already running, still one action", J.Bool(res, "ok") && J.Str(res, "message").StartsWith("Already running") && n.QueuedWork == 1, J.Write(res));
                n.WorkOnce(() => { }); // (the press only: it queues step 1; the run itself is never made here)
                Check("Start engine's press: the start sequence queued from step 1, no longer NeedsStart", n.PendingFrom == 1 && !n.NeedsStart, n.PendingFrom);
                Check("Start engine's press: the gold goes off, the hint is the normal one again", !J.Bool(J.Arr(status(), "menu")[0], "primary") && J.Str(status(), "hint") == "In TTS: Create");
                var o = new Controller(Layout.Make(Mode.Friend, tmp), true, tmp, Path.Combine(tmp, "state-ns-o"), "x.exe");
                var wo = Page(o, effects);
                var ores = Act(wo, "start-engine");
                Check("observe mode: Start engine refused, nothing queued, never gold", !J.Bool(ores, "ok") && J.Str(ores, "message") == "Observe mode: nothing is changed." && o.QueuedWork == 0 && !o.NeedsStart, J.Write(ores));
            }
            catch (Exception e) { Check("not started: no exception", false, e); }
        }

        static void StoppedStatus(Controller c, WebUi w)
        {
            var keep = c.Rows.Select(x => x.V).ToArray();
            var probe = c.TtsProbe;
            Func<Dictionary<string, object>> status = () => J.Parse(Send(w, Get(w, "/api/status", w.Token)).Body) as Dictionary<string, object>;
            try
            {
                c.Rows[0].V = new Verdict(Light.Green, "Running (Docker 29.8.2).");
                c.MarkStopped(true);
                var s = status();
                Check("stopped: the rows alone (Docker green, the rest grey) would say Ready, the old header", J.Str(J.Get(s, "worst"), "text") == "Ready" && J.Str(J.Get(s, "worst"), "state") == "green", J.Write(J.Get(s, "worst")));
                c.EverythingStopped = true;
                s = status();
                Check("stopped: after Stop everything the header says Stopped, grey", J.Str(J.Get(s, "worst"), "text") == "Stopped" && J.Str(J.Get(s, "worst"), "state") == "grey", J.Write(J.Get(s, "worst")));
                c.EngineStarted = false; // (as StopEverything leaves it)
                s = status();
                Check("stopped: still Stopped (not Not started), the hint says press Start engine, Start engine is the gold one",
                    J.Str(J.Get(s, "worst"), "text") == "Stopped" && J.Str(s, "hint") == Logic.StartHint && J.Bool(J.Arr(s, "menu")[0], "primary"), J.Str(J.Get(s, "worst"), "text") + " / " + J.Str(s, "hint"));
                c.EngineStarted = true;
                var lights = J.Arr(s, "lights");
                Check("stopped: TTS still open: its row says it runs, green, not Stopped.", J.Str(lights[5], "state") == "green" && J.Str(lights[5], "text") == "Tabletop Simulator is running (Stop everything leaves it open).", J.Str(lights[5], "text"));
                Check("stopped: the bridge's row is Stopped., grey; Docker's stays as it was", J.Str(lights[4], "text") == "Stopped." && J.Str(lights[4], "state") == "grey" && J.Str(lights[0], "state") == "green", J.Str(lights[4], "text") + " / " + J.Str(lights[0], "state"));
                c.MarkStopped(false);
                lights = J.Arr(status(), "lights");
                Check("stopped: TTS closed: its row says so, grey", J.Str(lights[5], "state") == "grey" && J.Str(lights[5], "text") == "Tabletop Simulator isn't running.", J.Str(lights[5], "text"));
                c.TtsProbe = () => true;
                c.Rows[Controller.StepTts].At = DateTime.MinValue;
                c.KeepTtsRowStopped();
                Check("stopped: TTS opened after the stop: the row follows it, its time with it", c.Rows[Controller.StepTts].V.Light == Light.Green && c.Rows[Controller.StepTts].V.Text.StartsWith("Tabletop Simulator is running") && (DateTime.Now - c.Rows[Controller.StepTts].At).TotalSeconds < 60, c.Rows[Controller.StepTts].V + " at " + c.Rows[Controller.StepTts].At);
                c.Rows[2].V = new Verdict(Light.Red, "The relay is up, but this PC can't log in to it.");
                s = status();
                Check("stopped: a red row still names the problem", J.Str(J.Get(s, "worst"), "text") == "Problem: Engine stack" && J.Str(J.Get(s, "worst"), "state") == "red", J.Write(J.Get(s, "worst")));
                Check("stopped: the tray's light is the header's", Logic.Overall(c.Rows.Select(x => x.V.Light), true) == Light.Red && Logic.Overall(new[] { Light.Green, Light.Grey }, true) == Light.Grey && Logic.Overall(new[] { Light.Green, Light.Grey }, false) == Light.Green);
            }
            catch (Exception e) { Check("stopped: no exception", false, e); }
            finally
            {
                for (int i = 0; i < keep.Length; i++) c.Rows[i].V = keep[i];
                c.EverythingStopped = false;
                c.TtsProbe = probe;
            }
        }

        static void Web()
        {
            sb.AppendLine("-- status page: HTTP parser");
            var r = Req("GET /api/status?x=1 HTTP/1.1\r\nHost: 127.0.0.1:48790\r\nx-mtg-token: abc\r\n\r\n");
            Check("a GET parses: method, path without the query, headers by any case", r != null && r.Error == 0 && r.Method == "GET" && r.Path == "/api/status" && r.Header("X-MTG-Token") == "abc", r == null ? null : r.Why);
            r = Req("POST /api/action HTTP/1.1\r\nHost: localhost:48790\r\nContent-Length: 11\r\n\r\n{\"id\":\"x\"}!");
            Check("a POST body is read to Content-Length", r != null && r.Error == 0 && r.Body == "{\"id\":\"x\"}!", r == null ? null : r.Body);
            Check("an empty connection: no request, no answer", Req("") == null);
            Check("garbage: 400", ErrOf("GARBAGE\r\n\r\n") == 400);
            Check("a request line with 4 parts: 400", ErrOf("GET / x HTTP/1.1\r\nHost: a\r\n\r\n") == 400);
            Check("an absolute URL as target: 400", ErrOf("GET http://evil.example/ HTTP/1.1\r\nHost: a\r\n\r\n") == 400);
            Check("a lower-case method: 400", ErrOf("get / HTTP/1.1\r\nHost: a\r\n\r\n") == 400);
            Check("HTTP/2.0: 505", ErrOf("GET / HTTP/2.0\r\nHost: a\r\n\r\n") == 505);
            Check("no version: 400", ErrOf("GET / FTP\r\nHost: a\r\n\r\n") == 400);
            Check("a header without a colon: 400", ErrOf("GET / HTTP/1.1\r\nHost: a\r\nnonsense\r\n\r\n") == 400);
            var fold = Req("GET / HTTP/1.1\r\nHost: a\r\nX-A: 1\r\n  more: x\r\n\r\n");
            Check("a folded header: 400, said as folded", fold.Error == 400 && fold.Why.Contains("folded"), fold.Why);
            Check("a space before the colon: 400", ErrOf("GET / HTTP/1.1\r\nHost : a\r\n\r\n") == 400);
            Check("bare LF line ends: 400", ErrOf("GET / HTTP/1.1\nHost: a\r\n\r\n") == 400);
            Check("a bare LF inside the headers (a smuggled header): 400", ErrOf("GET / HTTP/1.1\r\nHost: a\r\nX-A: 1\nX-MTG-Token: x\r\n\r\n") == 400);
            Check("two Host headers: 400", ErrOf("GET / HTTP/1.1\r\nHost: 127.0.0.1:48790\r\nHost: evil.example\r\n\r\n") == 400);
            Check("two Content-Length headers: 400", ErrOf("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\nab") == 400);
            Check("two token headers: 400", ErrOf("GET / HTTP/1.1\r\nHost: a\r\nX-MTG-Token: a\r\nx-mtg-token: b\r\n\r\n") == 400);
            Check("two Accept headers are merged, not refused", Req("GET / HTTP/1.1\r\nHost: a\r\nAccept: a\r\nAccept: b\r\n\r\n").Header("Accept") == "a, b");
            Check("chunked bodies: 501", ErrOf("POST / HTTP/1.1\r\nHost: a\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n") == 501);
            Check("Content-Length not a number: 400", ErrOf("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 1e3\r\n\r\n") == 400 && ErrOf("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: -1\r\n\r\n") == 400);
            Check("a big body (1 MB announced): 413 before reading it", ErrOf("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 1000000\r\n\r\n") == 413);
            Check("a 9-digit-plus Content-Length: 400 (no overflow)", ErrOf("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 99999999999\r\n\r\n") == 400);
            Check("a body at the limit is read", Req("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: " + MiniHttp.MaxBody + "\r\n\r\n" + new string('x', MiniHttp.MaxBody)).Body.Length == MiniHttp.MaxBody);
            Check("a body one byte over: 413", ErrOf("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: " + (MiniHttp.MaxBody + 1) + "\r\n\r\n") == 413);
            Check("a body shorter than Content-Length: 400", ErrOf("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 50\r\n\r\nshort") == 400);
            Check("a head over 8 KB: 431", ErrOf("GET / HTTP/1.1\r\nHost: a\r\nX-Big: " + new string('a', 9000) + "\r\n\r\n") == 431);
            Check("a head with no blank line, closed: 400", ErrOf("GET / HTTP/1.1\r\nHost: a\r\n") == 400);
            Check("over 50 headers: 431", ErrOf("GET / HTTP/1.1\r\nHost: a\r\n" + string.Concat(Enumerable.Range(0, 60).Select(i => "X-" + i + ": 1\r\n")) + "\r\n") == 431);
            Check("HTTP/1.1 without Host: 400", ErrOf("GET / HTTP/1.1\r\n\r\n") == 400);
            var nonAscii = Encoding.ASCII.GetBytes("GET / HTTP/1.1\r\nHost: a\r\nX: \r\n\r\n").ToList();
            nonAscii.Insert(nonAscii.Count - 4, 0xE9);
            var na = ReqBytes(nonAscii.ToArray());
            Check("a non-ASCII byte in the head: 400", na != null && na.Error == 400, na == null ? null : na.Why);
            var badUtf8 = Encoding.ASCII.GetBytes("POST / HTTP/1.1\r\nHost: a\r\nContent-Length: 2\r\n\r\n").Concat(new byte[] { 0xC3, 0x28 }).ToArray();
            var bu = ReqBytes(badUtf8);
            Check("a body that isn't UTF-8: 400", bu != null && bu.Error == 400, bu == null ? null : bu.Why);

            sb.AppendLine("-- status page: guards");
            var tmp = Path.Combine(Path.GetTempPath(), "mtg-companion-selftest-" + Guid.NewGuid().ToString("N").Substring(0, 6));
            var effects = new List<string>();
            var c = new Controller(Layout.Make(Mode.Friend, tmp), false, Path.Combine(tmp, "saves"), Path.Combine(tmp, "state"), "x.exe");
            c.Game = Game.None("No game.");
            c.EngineStarted = true; // (the page as it is after Start engine; before it: NotStartedStatus)
            var w = Page(c, effects);
            Check("the token: 32 hex characters, new for every run", w.Token.Length == 32 && w.Token.All(ch => "0123456789abcdef".IndexOf(ch) >= 0) && w.Token != new WebUi(c).Token, w.Token);
            var resp = Send(w, Get(w, "/", null));
            Check("GET / (no token needed): the page, with this run's token in it", resp.Status == 200 && resp.Type.StartsWith("text/html") && resp.Body.Contains("content='" + w.Token + "'") && !resp.Body.Contains("{{"), resp.Status);
            Check("the page: a CSP with a nonce the page's script and style carry", resp.Csp != null && resp.Csp.Contains("script-src 'nonce-") && resp.Csp.Contains("frame-ancestors 'none'")
                && resp.Body.Contains("<script nonce='" + resp.Csp.Split(new[] { "'nonce-" }, StringSplitOptions.None)[1].Split('\'')[0] + "'>"), resp.Csp);
            Check("the page: no external scripts, styles or fonts", !resp.Body.Contains("src='http") && !resp.Body.Contains("href='http") && !resp.Body.Contains("@import") && !resp.Body.Contains("url(http"));
            Check("the page: the update section is there but hidden until the API sends one", resp.Body.Contains("id='update' hidden"));
            resp = Send(w, "GET / HTTP/1.1\r\nHost: evil.example:48790\r\n\r\n");
            Check("bad Host (DNS rebinding): 403, no page, no token", resp.Status == 403 && ErrorId(resp) == "bad-host" && !resp.Body.Contains(w.Token), resp.Body);
            resp = Send(w, "GET /api/status HTTP/1.1\r\nHost: evil.example\r\n" + WebUi.TokenHeader + ": " + w.Token + "\r\n\r\n");
            Check("bad Host with the right token: still 403", resp.Status == 403 && ErrorId(resp) == "bad-host", resp.Body);
            Check("Host without the port, or another port: refused", !w.HostOk("127.0.0.1") && !w.HostOk("127.0.0.1:48791") && !w.HostOk("localhost") && !w.HostOk(null) && !w.HostOk("127.0.0.1:48790.evil.example")
                && !w.HostOk("localhost:48790.evil.example") && !w.HostOk("localhost:487901"));
            Check("Host 127.0.0.1:port or localhost:port (any case): allowed", w.HostOk("127.0.0.1:48790") && w.HostOk("localhost:48790") && w.HostOk("LocalHost:48790"));
            Check("HTTP/1.0 without Host: 403", Send(w, "GET / HTTP/1.0\r\n\r\n").Status == 403);
            resp = Send(w, Get(w, "/api/status", null));
            Check("/api/status without the token: 403 bad-token", resp.Status == 403 && ErrorId(resp) == "bad-token", resp.Body);
            resp = Send(w, Get(w, "/api/status", w.Token.Substring(0, 31) + (w.Token[31] == '0' ? "1" : "0")));
            Check("/api/status with a wrong token: 403", resp.Status == 403 && ErrorId(resp) == "bad-token", resp.Body);
            Check("a token prefix or a longer token: refused", !w.TokenOk(w.Token.Substring(0, 16)) && !w.TokenOk(w.Token + "0") && !w.TokenOk("") && w.TokenOk(w.Token));
            resp = Send(w, Get(w, "/api/status", w.Token));
            Check("/api/status with the token: 200 JSON", resp.Status == 200 && resp.Type.StartsWith("application/json") && J.Parse(resp.Body) is Dictionary<string, object>, resp.Status);
            resp = Send(w, Get(w, "/api/status", w.Token, "Origin: http://evil.example\r\n"));
            Check("a cross-origin Origin: 403 bad-origin", resp.Status == 403 && ErrorId(resp) == "bad-origin", resp.Body);
            resp = Send(w, Get(w, "/", null, "Origin: null\r\n"));
            Check("Origin: null (a sandboxed frame or file page): 403", resp.Status == 403 && ErrorId(resp) == "bad-origin", resp.Body);
            Check("Origin with another port or https: refused", !w.OriginOk("http://127.0.0.1:48791") && !w.OriginOk("https://127.0.0.1:48790") && !w.OriginOk("http://127.0.0.1:48790.evil.example"));
            resp = Send(w, Get(w, "/api/status", w.Token, "Origin: http://localhost:48790\r\n"));
            Check("the page's own Origin (localhost): allowed", resp.Status == 200, resp.Body);
            resp = Send(w, Get(w, "/api/status", w.Token, "Sec-Fetch-Site: cross-site\r\n"));
            Check("Sec-Fetch-Site cross-site on the API: 403", resp.Status == 403 && ErrorId(resp) == "cross-site", resp.Body);
            Check("Sec-Fetch-Site same-site on the API: 403", Send(w, Get(w, "/api/status", w.Token, "Sec-Fetch-Site: same-site\r\n")).Status == 403);
            Check("Sec-Fetch-Site same-origin: allowed", Send(w, Get(w, "/api/status", w.Token, "Sec-Fetch-Site: same-origin\r\n")).Status == 200);
            Check("Sec-Fetch-Site none (the address bar): allowed", Send(w, Get(w, "/api/status", w.Token, "Sec-Fetch-Site: none\r\n")).Status == 200);
            resp = Send(w, Post(w, "{\"id\":\"restart-engine\"}", null));
            Check("POST without the token: 403, nothing done", resp.Status == 403 && ErrorId(resp) == "bad-token", resp.Body);
            resp = Send(w, Post(w, "{\"id\":\"restart-engine\"}", "deadbeef"));
            Check("POST with a bad token: 403", resp.Status == 403 && ErrorId(resp) == "bad-token", resp.Body);
            resp = Send(w, Post(w, "{\"id\":\"restart-engine\"}", w.Token, "", "text/plain"));
            Check("POST as text/plain (a form or no-cors fetch): 415", resp.Status == 415, resp.Body);
            var notJson = new[] { "application/jsonx", "text/json", "application/json; foo=bar", "application/json, text/plain", "application/json; charset=latin1", "application/json; charset=utf-8; x=1", "" };
            Check("POST: Content-Type must be exactly application/json, else 415", notJson.All(t => Send(w, Post(w, "{\"id\":\"zz\"}", w.Token, "", t)).Status == 415)
                && notJson.All(t => !WebUi.JsonType(t)) && !WebUi.JsonType(null));
            Check("POST: application/json with charset=utf-8 (any case, quoted or not) gets past the type check",
                Send(w, Post(w, "{\"id\":\"zz\"}", w.Token, "", "Application/JSON; charset=\"UTF-8\"")).Status == 400 && WebUi.JsonType("application/json") && WebUi.JsonType("application/json;charset=utf-8"));
            resp = Send(w, Post(w, "{\"id\":\"open-logs\"}", w.Token, "").Replace("Origin: http://127.0.0.1:" + w.Port, "Origin: http://evil.example"));
            Check("POST with a cross-origin Origin and the token: 403, nothing done", resp.Status == 403 && ErrorId(resp) == "bad-origin" && effects.Count == 0, resp.Body);
            Check("POST not JSON: 400", Send(w, Post(w, "id=restart-engine", w.Token)).Status == 400);
            Check("POST JSON without an id: 400", Send(w, Post(w, "{\"x\":1}", w.Token)).Status == 400);
            Check("POST an unknown id: 400", Send(w, Post(w, "{\"id\":\"format-c\"}", w.Token)).Status == 400);
            var keepLog = Log.File;
            Log.File = Path.Combine(Path.GetTempPath(), "mtg-companion-selftest-log-" + Guid.NewGuid().ToString("N").Substring(0, 6) + ".log");
            try
            {
                Send(w, Post(w, "{\"id\":\"format-c-evil\"}", w.Token));
                Send(w, Post(w, "{\"id\":\"fix:9:x-evil\"}", w.Token));
                Send(w, Post(w, "{\"id\":\"wsl-limits\"}", w.Token)); // (writes only the never-written temp path's file: see Page())
                string logged = File.Exists(Log.File) ? File.ReadAllText(Log.File) : "";
                Check("the log: a known action is written, an unknown id never is", logged.Contains("status page: wsl-limits") && !logged.Contains("evil"), logged);
            }
            finally { try { File.Delete(Log.File); } catch { } Log.File = keepLog; }
            try { File.Delete(w.WslFile); } catch { }
            Check("GET /api/action: 405", Send(w, Get(w, "/api/action", w.Token)).Status == 405);
            Check("POST /api/status: 405", Send(w, "POST /api/status HTTP/1.1\r\nHost: 127.0.0.1:48790\r\n" + WebUi.TokenHeader + ": " + w.Token + "\r\nContent-Length: 0\r\n\r\n").Status == 405);
            Check("DELETE /: 405", Send(w, "DELETE / HTTP/1.1\r\nHost: 127.0.0.1:48790\r\n\r\n").Status == 405);
            Check("an unknown path: 404; an unknown /api path without a token: 403", Send(w, Get(w, "/etc/passwd", null)).Status == 404 && Send(w, Get(w, "/api/x", null)).Status == 403);
            Check("a parse error is answered with its status", w.Handle(HttpReq.Fail(431, "big")).Status == 431);
            var wire = Encoding.ASCII.GetString(MiniHttp.Write(Send(w, Get(w, "/", null))));
            Check("answers: no-store, nosniff, frame DENY, Connection: close, no CORS header", wire.Contains("Cache-Control: no-store") && wire.Contains("X-Content-Type-Options: nosniff")
                && wire.Contains("X-Frame-Options: DENY") && wire.Contains("Connection: close") && !wire.Contains("Access-Control-Allow"));
            Check("answers: no referrer; the page's CSP lets it talk to itself only", wire.Contains("Referrer-Policy: no-referrer\r\n")
                && wire.Contains("connect-src 'self';") && wire.Contains("default-src 'none';") && wire.Contains("form-action 'none'"));
            Check("answers: Content-Length counts UTF-8 bytes", Encoding.ASCII.GetString(MiniHttp.Write(new HttpResp(200, "é"))).Contains("Content-Length: 2\r\n"));

            sb.AppendLine("-- status page: JSON");
            c.Rows[0].V = new Verdict(Light.Green, "Running (Docker 29.8.2).");
            c.Rows[1].V = new Verdict(Light.Busy, "Loading the engine images: 40%.");
            c.Rows[2].V = new Verdict(Light.Red, "The relay is up, but this PC can't log in to it.").WithFix(Fixes.StackRestart, "Restart relay and room");
            c.Rows[3].V = new Verdict(Light.Green, "Installed as TS_Save_2.json.").WithFix(Fixes.Retry, "Try again");
            c.Rows[4].V = new Verdict(Light.Amber, "Running, but it isn't this package's bridge.").WithFix(Fixes.BridgeRestart, "Restart the bridge");
            c.Rows[5].V = new Verdict(Light.Amber, "Tabletop Simulator isn't running.").WithFix(Fixes.TtsOpen, "Open TTS").WithHint("In TTS: Create");
            var s = J.Parse(Send(w, Get(w, "/api/status", w.Token)).Body);
            var lights = J.Arr(s, "lights");
            Check("status: api 1, mode, phase, observe", J.Int(s, "api") == 1 && J.Str(s, "mode") == "friend" && J.Has(s, "phase") && J.Has(s, "observe") && !J.Bool(s, "observe"));
            Check("status: six lights, each with step, name, state, text, action", lights != null && lights.Length == 6 && lights.All(l => J.Has(l, "step") && J.Has(l, "name") && J.Has(l, "state") && J.Has(l, "text") && J.Has(l, "action")), lights == null ? 0 : lights.Length);
            Check("status: states are green/amber/red/grey only", lights.All(l => new[] { "green", "amber", "red", "grey" }.Contains(J.Str(l, "state"))));
            Check("status: a working light is amber with busy:true", J.Str(lights[1], "state") == "amber" && J.Bool(lights[1], "busy") && !J.Bool(lights[0], "busy"));
            Check("status: names in step order", string.Join(",", lights.Select(l => J.Str(l, "name"))) == string.Join(",", Controller.Names));
            var a2 = J.Get(lights[2], "action");
            Check("status: a red light's button: id fix:2:stack-restart, its label, unlocked", J.Str(a2, "id") == "fix:2:stack-restart" && J.Str(a2, "label") == "Restart relay and room" && !J.Bool(a2, "locked") && J.Str(a2, "confirm") != null, J.Write(a2));
            Check("status: a green light shows no button even with a fix (as the window)", J.Get(lights[3], "action") == null && J.Get(lights[0], "action") == null);
            Check("status: an amber light's button", J.Str(J.Get(lights[5], "action"), "id") == "fix:5:tts-open");
            Check("status: worst red names the light", J.Str(J.Get(s, "worst"), "state") == "red" && J.Str(J.Get(s, "worst"), "text") == "Problem: Engine stack", J.Write(J.Get(s, "worst")));
            Check("status: the hint of the first amber/red light", J.Str(s, "hint") == "In TTS: Create", J.Str(s, "hint"));
            var game = J.Get(s, "game");
            Check("status: game none, unlocked", J.Str(game, "kind") == "none" && !J.Bool(game, "locked") && J.Get(game, "lockText") == null, J.Write(game));
            var menu = J.Arr(s, "menu");
            Check("status: the menu: start-engine, restart-engine, stop-everything, open-logs, wsl-limits", menu != null && string.Join(",", menu.Select(m => J.Str(m, "id"))) == "start-engine,restart-engine,stop-everything,open-logs,wsl-limits", menu == null ? null : string.Join(",", menu.Select(m => J.Str(m, "id"))));
            Check("status: started: Start engine stays enabled but isn't the gold one", J.Bool(menu[0], "enabled") && !J.Bool(menu[0], "primary") && J.Str(menu[0], "label") == "Start engine", J.Write(menu[0]));
            Check("status: versions, a log with lines, the update section (friend mode)", J.Has(s, "versions") && J.Str(J.Get(s, "versions"), "companion") != null && J.Arr(J.Get(s, "log"), "lines") != null && J.Get(s, "update") is Dictionary<string, object>);
            StoppedStatus(c, w);
            NotStartedStatus(tmp);
            var keepV = c.Rows[0].V;
            c.Rows[0].V = null; // (a bug inside: Status() throws)
            resp = Send(w, Get(w, "/api/status", w.Token));
            c.Rows[0].V = keepV;
            Check("a failure inside: 500 with a plain sentence, never the exception", resp.Status == 500 && ErrorId(resp) == "error" && !resp.Body.Contains("Exception") && !resp.Body.Contains(" at "), resp.Body);
            w.Managing = true;
            c.WindowVisible = false;
            Send(w, Get(w, "/api/status", w.Token));
            bool shownByPoll = c.WindowVisible;
            w.IdleCheck(DateTime.UtcNow.AddSeconds(5));
            bool stillShown = c.WindowVisible;
            w.IdleCheck(DateTime.UtcNow.AddSeconds(25));
            Check("a page polling counts as the window shown; 20 s without a poll: hidden (the watcher slows down)", shownByPoll && stillShown && !c.WindowVisible);
            w.Managing = false;
            c.WindowVisible = true;

            sb.AppendLine("-- status page: actions go through the game lock");
            c.Game = Game.On("Game on: turn 6, 4 seats.", 6);
            s = J.Parse(Send(w, Get(w, "/api/status", w.Token)).Body);
            lights = J.Arr(s, "lights");
            game = J.Get(s, "game");
            Check("game on: status says locked, kind on, the lock sentence", J.Bool(game, "locked") && J.Str(game, "kind") == "on" && J.Str(game, "lockText") == Logic.LockText(c.Game), J.Write(game));
            Check("game on: the Restart relay and room button shows locked", J.Bool(J.Get(lights[2], "action"), "locked") && J.Bool(J.Get(lights[4], "action"), "locked") && !J.Bool(J.Get(lights[5], "action"), "locked"));
            Check("game on: Restart engine disabled in the menu", !J.Bool(J.Arr(s, "menu")[1], "enabled") && J.Str(J.Arr(s, "menu")[1], "label").Contains("locked"));
            var res = Act(w, "restart-engine");
            Check("game on: POST restart-engine refused with the lock sentence", !J.Bool(res, "ok") && J.Str(res, "message") == Logic.LockText(c.Game), J.Write(res));
            res = Act(w, "fix:2:stack-restart");
            Check("game on: POST Restart relay and room refused", !J.Bool(res, "ok") && J.Str(res, "message") == Logic.LockText(c.Game), J.Write(res));
            res = Act(w, "fix:4:bridge-restart");
            Check("game on: POST Restart the bridge refused", !J.Bool(res, "ok") && J.Str(res, "message") == Logic.LockText(c.Game), J.Write(res));
            c.Rows[1].V = new Verdict(Light.Red, "Loading the engine images didn't work.").WithFix(Fixes.ImagesLoad, "Load the engine again");
            res = Act(w, "fix:1:images-load");
            Check("game on: POST Load the engine images refused", !J.Bool(res, "ok") && J.Str(res, "message") == Logic.LockText(c.Game), J.Write(res));
            res = Act(w, "fix:5:tts-open");
            Check("game on: POST Open TTS goes through (never locked)", J.Bool(res, "ok"), J.Write(res));
            res = Act(w, "stop-everything");
            Check("game on: Stop everything first asks again (needConfirm), does nothing", !J.Bool(res, "ok") && J.Bool(res, "needConfirm") && J.Str(res, "message").Contains("ends that game"), J.Write(res));
            c.Game = Game.CantTell("Can't tell whether a game is on: the bridge didn't answer (timeout).");
            var ctMenu = J.Arr(J.Parse(Send(w, Get(w, "/api/status", w.Token)).Body), "menu")[1];
            Check("can't tell: the Restart engine label says can't tell, not game on", J.Str(ctMenu, "label") == "Restart engine (locked: can't tell)" && !J.Bool(ctMenu, "enabled"), J.Str(ctMenu, "label"));
            c.Game = Game.On("Game on: turn 6, 4 seats.", 6);
            res = Act(w, "stop-everything", true);
            Check("game on: Stop everything confirmed goes through (as the window's warning)", J.Bool(res, "ok"), J.Write(res));
            c.Game = Game.CantTell("bridge slow");
            res = Act(w, "restart-engine");
            Check("can't tell: restart-engine refused too", !J.Bool(res, "ok") && J.Str(res, "message").Contains("can't tell"), J.Write(res));
            res = Act(w, "fix:2:stack-restart");
            Check("can't tell: Restart relay and room refused", !J.Bool(res, "ok") && J.Str(res, "message").Contains("can't tell"), J.Write(res));
            c.Game = Game.None("No game.");
            res = Act(w, "fix:2:bridge-restart");
            Check("a stale button (the light's fix changed): refused", !J.Bool(res, "ok") && J.Str(res, "message").Contains("changed"), J.Write(res));
            res = Act(w, "fix:3:retry");
            Check("a fix on a green light (no button shown): refused", !J.Bool(res, "ok") && J.Str(res, "message").Contains("no button"), J.Write(res));
            Check("fix ids out of range or malformed: 400", Send(w, Post(w, "{\"id\":\"fix:6:retry\"}", w.Token)).Status == 400 && Send(w, Post(w, "{\"id\":\"fix:-1:retry\"}", w.Token)).Status == 400
                && Send(w, Post(w, "{\"id\":\"fix:2\"}", w.Token)).Status == 400 && Send(w, Post(w, "{\"id\":\"fix:x:retry\"}", w.Token)).Status == 400);
            res = Act(w, "fix:2:stack-restart");
            Check("no game: Restart relay and room goes through", J.Bool(res, "ok"), J.Write(res));
            res = Act(w, "restart-engine");
            Check("no game: restart-engine goes through", J.Bool(res, "ok"), J.Write(res));
            int q0 = c.QueuedWork;
            res = Act(w, "restart-engine");
            Check("restart-engine again while the first is still queued: a no-op that says so", J.Bool(res, "ok") && J.Str(res, "message").StartsWith("Already") && c.QueuedWork == q0, J.Write(res));
            res = Act(w, "fix:2:stack-restart");
            var res2 = Act(w, "fix:2:stack-restart");
            Check("a fix pressed twice: queued once (another action in between still counts as new)", J.Bool(res, "ok") && !J.Str(res, "message").StartsWith("Already")
                && J.Bool(res2, "ok") && J.Str(res2, "message").StartsWith("Already") && c.QueuedWork == q0 + 1, J.Write(res2) + " " + c.QueuedWork);
            res = Act(w, "stop-everything");
            res2 = Act(w, "stop-everything");
            Check("stop-everything pressed twice: queued once", J.Bool(res, "ok") && J.Str(res2, "message").StartsWith("Already") && c.QueuedWork == q0 + 2, J.Write(res2) + " " + c.QueuedWork);
            res = Act(w, "open-logs");
            Check("open-logs opens the package's logs folder", J.Bool(res, "ok") && effects.Count == 1 && effects[0] == "folder " + c.L.LogsDir, string.Join("|", effects));
            c.Rows[4].V = new Verdict(Light.Red, "Code.exe (process 4242) is using port 39998.").WithFix(Fixes.ShowProgram, "Show the program");
            res = Act(w, "fix:4:show-program");
            Check("show-program opens Task Manager", J.Bool(res, "ok") && effects.Contains("run taskmgr.exe"), string.Join("|", effects));

            var o = new Controller(Layout.Make(Mode.Friend, tmp), true, tmp, tmp, "x.exe");
            o.Game = Game.None("No game.");
            o.Rows[4].V = c.Rows[4].V;
            o.Rows[2].V = new Verdict(Light.Red, "The engine isn't running.").WithFix(Fixes.StackRestart, "Start the engine");
            var oe = new List<string>();
            var ow = Page(o, oe);
            Check("observe: no buttons on the lights, restart and stop disabled", J.Arr(J.Parse(Send(ow, Get(ow, "/api/status", ow.Token)).Body), "lights").All(l => J.Get(l, "action") == null)
                && !J.Bool(J.Arr(J.Parse(Send(ow, Get(ow, "/api/status", ow.Token)).Body), "menu")[1], "enabled"));
            Check("observe: every change refused (restart, stop, a fix, show-program, wsl)", new[] { "restart-engine", "stop-everything", "fix:2:stack-restart", "fix:4:show-program", "wsl-limits" }.All(id => !J.Bool(Act(ow, id), "ok")) && oe.Count == 0, string.Join("|", oe));

            sb.AppendLine("-- status page: table tools (/api/tools)");
            var calls = new List<string>();
            HttpResult bridgeAnswer = HttpResult.Ok("{\"seats\":[],\"debug\":{\"on\":false}}");
            w.BridgeCall = (m, p, j) => { calls.Add(m + " " + p + " " + j); return bridgeAnswer; };
            Func<string, string> postTools = json => Send(w, Post(w, json, w.Token).Replace("POST /api/action ", "POST /api/tools ")).Body;
            var tg = Send(w, Get(w, "/api/tools", w.Token));
            Check("tools: GET passes the bridge's GET /tools through", tg.Status == 200 && tg.Body == bridgeAnswer.Body && calls.Count == 1 && calls[0] == "GET /tools ", string.Join("|", calls));
            Check("tools: GET without the token: 403, the bridge not asked", Send(w, Get(w, "/api/tools", null)).Status == 403 && calls.Count == 1);
            bridgeAnswer = HttpResult.Ok("{\"ok\":true,\"message\":\"Red: Harmless bot playing X.\",\"extra\":1}");
            var tp = J.Parse(postTools("{ \"kind\" : \"ai-seat\", \"color\": \"Red\", \"seat\": \"harmless\", \"junk\": [1] }"));
            Check("tools: POST a known kind: passed on as parsed (written again), answered {ok, message} only", J.Bool(tp, "ok") && J.Str(tp, "message") == "Red: Harmless bot playing X." && !J.Has(tp, "extra")
                && calls.Count == 2 && calls[1] == "POST /tools {\"kind\":\"ai-seat\",\"color\":\"Red\",\"seat\":\"harmless\",\"junk\":[1]}", string.Join("|", calls));
            // (the Starting hand box: Set and Clear; the bridge checks the names and the game)
            bridgeAnswer = HttpResult.Ok("{\"ok\":true,\"message\":\"Picked hand for Blue's next game: Lightning Bolt.\"}");
            var th = J.Parse(postTools("{\"kind\":\"hand\",\"color\":\"Blue\",\"names\":[\"Lightning Bolt\",\"Neheb, the Worthy\"]}"));
            postTools("{\"kind\":\"hand\",\"color\":\"Blue\",\"clear\":true}");
            Check("tools: POST a starting hand (Set, Clear): passed on as parsed, the names in order", J.Bool(th, "ok") && calls.Count == 4
                && calls[2] == "POST /tools {\"kind\":\"hand\",\"color\":\"Blue\",\"names\":[\"Lightning Bolt\",\"Neheb, the Worthy\"]}" && calls[3] == "POST /tools {\"kind\":\"hand\",\"color\":\"Blue\",\"clear\":true}", string.Join("|", calls));
            calls.RemoveRange(2, 2);
            var tpBad = Send(w, Post(w, "{\"kind\":\"format-c\"}", w.Token).Replace("POST /api/action ", "POST /api/tools "));
            Check("tools: POST an unknown kind: 400, the bridge not asked", tpBad.Status == 400 && ErrorId(tpBad) == "bad-body" && calls.Count == 2, tpBad.Body);
            Check("tools: POST not JSON: 400; the wrong type: 415", Send(w, Post(w, "kind=debug", w.Token).Replace("POST /api/action ", "POST /api/tools ")).Status == 400
                && Send(w, Post(w, "{\"kind\":\"debug\"}", w.Token, "", "text/plain").Replace("POST /api/action ", "POST /api/tools ")).Status == 415 && calls.Count == 2);
            bridgeAnswer = HttpResult.Of(HttpKind.Refused);
            var tDown = Send(w, Get(w, "/api/tools", w.Token));
            Check("tools: no bridge: 502, saying to start the engine", tDown.Status == 502 && ErrorId(tDown) == "no-bridge" && J.Str(J.Parse(tDown.Body), "message").Contains("isn't running"), tDown.Body);
            bridgeAnswer = new HttpResult { Kind = HttpKind.Ok, Status = 404, Body = "" };
            var tOldGet = Send(w, Get(w, "/api/tools", w.Token));
            bridgeAnswer = HttpResult.Ok("<html>not json</html>");
            var tJunk = Send(w, Get(w, "/api/tools", w.Token));
            Check("tools: GET: a 404 or an answer that isn't a JSON object is no state: 502", tOldGet.Status == 502 && J.Str(J.Parse(tOldGet.Body), "message").Contains("no table tools") && tJunk.Status == 502, tOldGet.Body + " " + tJunk.Body);
            bridgeAnswer = new HttpResult { Kind = HttpKind.Ok, Status = 404, Body = "" };
            var tOld =Send(w, Post(w, "{\"kind\":\"debug-mode\",\"on\":true}", w.Token).Replace("POST /api/action ", "POST /api/tools "));
            Check("tools: an older bridge without /tools: 502, saying so", tOld.Status == 502 && J.Str(J.Parse(tOld.Body), "message").Contains("no table tools"), tOld.Body);
            var ocalls = new List<string>();
            ow.BridgeCall = (m, p, j) => { ocalls.Add(m + " " + p); return HttpResult.Ok("{\"ok\":true,\"message\":\"x\"}"); };
            var oTool = J.Parse(Send(ow, Post(ow, "{\"kind\":\"debug\",\"tool\":\"life\",\"color\":\"Red\",\"n\":5}", ow.Token).Replace("POST /api/action ", "POST /api/tools ")).Body);
            Check("tools: observe: every POST refused, the bridge not asked; GET still shows", !J.Bool(oTool, "ok") && J.Str(oTool, "message") == "Observe mode: nothing is changed." && ocalls.Count == 0
                && Send(ow, Get(ow, "/api/tools", ow.Token)).Status == 200 && ocalls.Count == 1, string.Join("|", ocalls));

            sb.AppendLine("-- status page: the update section");
            var st0 = J.Parse(Send(w, Get(w, "/api/status", w.Token)).Body);
            var up0 = J.Get(st0, "update");
            var acts0 = J.Arr(up0, "actions");
            Check("update: friend mode: a section with Check for updates", up0 is Dictionary<string, object> && J.Str(up0, "title") == "Updates" && acts0.Length == 1 && J.Str(acts0[0], "id") == "update-check" && J.Bool(acts0[0], "enabled"), J.Write(up0));
            Check("update: its line says this package's version before any check", (J.Str(up0, "line") ?? "").StartsWith("This package: "), J.Str(up0, "line"));
            var nu = Act(w, "update-now");
            Check("update-now with nothing offered: refused, says to check first", !J.Bool(nu, "ok") && J.Str(nu, "message").Contains("check for updates first"), J.Write(nu));
            nu = Act(w, "update-later");
            Check("update-later with nothing offered: refused", !J.Bool(nu, "ok") && J.Str(nu, "message").Contains("No update is offered"), J.Write(nu));
            Check("observe: no update section", J.Get(J.Parse(Send(ow, Get(ow, "/api/status", ow.Token)).Body), "update") == null);
            Check("observe: the update actions refused", new[] { "update-check", "update-now", "update-later" }.All(id => !J.Bool(Act(ow, id), "ok")));
            Func<UpdateState, bool, bool, object> Sec = (us, fr, ob) => J.Parse(J.Write(WebUi.UpdateSection(us, fr, ob))); // (as the page gets it)
            var avail = new UpdateState { Status = "available", Current = "v1", Available = "v2", Notes = "Update available: v2 (bridge and decks; 1.0 MB to download).", Text = "Update available: v2 (bridge and decks; 1.0 MB to download).", LastCheck = "2026-11-10T12:00:00Z" };
            var sec = Sec(avail, true, false);
            var ids = J.Arr(sec, "actions").Select(a => J.Str(a, "id")).ToArray();
            Check("update: offered: Update now, Later, Check, in the menu's shape", ids.SequenceEqual(new[] { "update-now", "update-later", "update-check" }) && J.Arr(sec, "actions").All(a => J.Has(a, "label") && J.Has(a, "enabled") && J.Has(a, "title") && J.Has(a, "confirm") && J.Has(a, "confirmLocked")), string.Join(",", ids));
            Check("update: Update now asks first, naming the version and that a game only gets a download", J.Str(J.Arr(sec, "actions")[0], "confirm").Contains("v2") && J.Str(J.Arr(sec, "actions")[0], "confirm").Contains("after the game") && J.Str(sec, "title") == "Update available: v2" && J.Str(sec, "available") == "v2", J.Str(J.Arr(sec, "actions")[0], "confirm"));
            avail.Later = true;
            Check("update: after Later: no Later button", !J.Arr(Sec(avail, true, false), "actions").Any(a => J.Str(a, "id") == "update-later"));
            var dlState = new UpdateState { Status = "downloading", Available = "v2", Progress = 40, Text = "Downloading app.zip: 40% of 1.0 MB." };
            sec = Sec(dlState, true, false);
            Check("update: downloading: the percentage, no install or check button to press", J.Str(sec, "title") == "Downloading update (40%)" && J.Int(sec, "progress") == 40 && J.Arr(sec, "actions").All(a => !J.Bool(a, "enabled") || J.Str(a, "id") != "update-check") && !J.Arr(sec, "actions").Any(a => J.Str(a, "id") == "update-now"), J.Write(sec));
            var failedState = new UpdateState { Status = "failed", Available = "v2", Error = "The update failed and was undone: x.", Text = "The update failed and was undone: x." };
            sec = Sec(failedState, true, false);
            Check("update: failed with a release offered: Update now again, no Later, the error", J.Arr(sec, "actions").Select(a => J.Str(a, "id")).SequenceEqual(new[] { "update-now", "update-check" }) && J.Str(sec, "error").Contains("undone") && J.Str(sec, "title") == "Update problem", J.Write(sec));
            sec = Sec(new UpdateState { Status = "ready", Available = "v2", DeferredUntilGameEnds = true, Text = "Update ready — will install after this game." }, true, false);
            Check("update: waiting for the game: says so, nothing to install by hand", J.Bool(sec, "deferred") && J.Str(sec, "title").Contains("after the game") && !J.Arr(sec, "actions").Any(a => J.Str(a, "id") == "update-now"), J.Write(sec));
            Check("update: home mode and observe: no section", Sec(avail, false, false) == null && Sec(avail, true, true) == null);
            Check("update: an interrupted install has its own title", WebUi.UpdateTitle(new UpdateState { Status = "interrupted" }).Contains("interrupted") && WebUi.UpdateTitle(new UpdateState { Status = "installing" }) == "Installing update");

            sb.AppendLine("-- status page: when it opens by itself");
            Check("first start of a package: opens", WebUi.OpenAtStart(true, false, false));
            Check("later starts: not at start", !WebUi.OpenAtStart(true, false, true));
            Check("home mode and observe: not at start", !WebUi.OpenAtStart(false, false, false) && !WebUi.OpenAtStart(true, true, false));
            Check("after the first pass: with a red light", WebUi.OpenAfterFirstPass(false, new[] { Light.Green, Light.Red }) && !WebUi.OpenAfterFirstPass(false, new[] { Light.Green, Light.Amber, Light.Busy }) && !WebUi.OpenAfterFirstPass(true, new[] { Light.Red }));
            Check("after the first pass: or with nothing started (the page has Start engine); never in observe mode", WebUi.OpenAfterFirstPass(false, new[] { Light.Green, Light.Grey }, true) && !WebUi.OpenAfterFirstPass(false, new[] { Light.Green, Light.Grey }, false) && !WebUi.OpenAfterFirstPass(true, new[] { Light.Grey }, true));
            var st = new Controller(Layout.Make(Mode.Friend, tmp), false, tmp, Path.Combine(tmp, "state"), "x.exe");
            bool before = st.StatusPageShownBefore();
            st.MarkStatusPageShown();
            Check("state.json: the flag is written once and read back", !before && st.StatusPageShownBefore() && J.Bool(J.Parse(File.ReadAllText(Path.Combine(tmp, "state", "state.json"))), "statusPageShown"));
            Func<string, Controller> fresh = name =>
            {
                var x = new Controller(Layout.Make(Mode.Friend, tmp), false, tmp, Path.Combine(tmp, "state-" + name), "x.exe");
                x.Game = Game.None("No game.");
                x.EngineStarted = true;
                foreach (var row in x.Rows) row.V = new Verdict(Light.Green, "Fine.");
                return x;
            };
            int opens = 0, windows = 0;
            Action win = () => Interlocked.Increment(ref windows);
            Action<Action> direct = a => a();
            var f1 = fresh("first");
            string did = WebUi.AutoOpen(f1, false, () => { opens++; return true; }, win, direct, 20);
            Check("first start: opens the page, writes the flag", did == "first" && opens == 1 && windows == 0 && f1.StatusPageShownBefore(), did);
            var f2 = fresh("no-browser");
            opens = 0;
            did = WebUi.AutoOpen(f2, false, () => { opens++; return false; }, win, direct, 20);
            Check("first start, no browser opened: the window instead, no flag (the next start tries again)", did == "window" && opens == 1 && windows == 1 && !f2.StatusPageShownBefore(), did);
            opens = 0; windows = 0;
            did = WebUi.AutoOpen(f2, true, () => { opens++; return true; }, win, direct, 20);
            Check("--no-browser: opens nothing, writes no flag", did == "off" && opens == 0 && windows == 0 && !f2.StatusPageShownBefore(), did);
            var f3 = fresh("later-red");
            f3.MarkStatusPageShown();
            f3.Rows[2].V = new Verdict(Light.Red, "The engine isn't running.");
            int o3 = 0;
            did = WebUi.AutoOpen(f3, false, () => { Interlocked.Increment(ref o3); return true; }, win, direct, 20);
            Thread.Sleep(200);
            int early = o3;
            f3.FirstPassDone = true;
            var until = DateTime.UtcNow.AddSeconds(3);
            while (o3 == 0 && DateTime.UtcNow < until) Thread.Sleep(10);
            Thread.Sleep(100);
            Check("a later start: waits for the first pass, then opens once on a red light", did == "watching" && early == 0 && o3 == 1, did + " early " + early + " then " + o3);
            var f4 = fresh("later-green");
            f4.MarkStatusPageShown();
            f4.FirstPassDone = true;
            int o4 = 0;
            did = WebUi.AutoOpen(f4, false, () => { Interlocked.Increment(ref o4); return true; }, win, direct, 20);
            var f5 = fresh("later-red-no-browser");
            f5.MarkStatusPageShown();
            f5.Rows[4].V = new Verdict(Light.Red, "The bridge stopped.");
            f5.FirstPassDone = true;
            windows = 0;
            WebUi.AutoOpen(f5, false, () => false, win, direct, 20);
            Thread.Sleep(300);
            Check("a later start, all green: opens nothing; red and no browser: the window", did == "watching" && o4 == 0 && windows == 1, o4 + " " + windows);
            var fNs = fresh("later-not-started");
            fNs.MarkStatusPageShown();
            fNs.EngineStarted = false;
            foreach (var row in fNs.Rows) row.V = new Verdict(Light.Grey, "Not running. Start engine starts it.");
            fNs.FirstPassDone = true;
            int oNs = 0;
            WebUi.AutoOpen(fNs, false, () => { Interlocked.Increment(ref oNs); return true; }, win, direct, 20);
            var untilNs = DateTime.UtcNow.AddSeconds(3);
            while (oNs == 0 && DateTime.UtcNow < untilNs) Thread.Sleep(10);
            Check("a later start that started nothing (no red light): opens the page, where Start engine is", oNs == 1, oNs);
            var t0 = new DateTime(2026, 1, 1, 0, 0, 0, DateTimeKind.Utc);
            Check("tray clicks: a double click opens once; a click after the window opens again", !WebUi.ClickAllowed(t0, t0.AddMilliseconds(300), 1000)
                && WebUi.ClickAllowed(t0, t0.AddMilliseconds(1000), 1000) && WebUi.ClickAllowed(DateTime.MinValue, DateTime.UtcNow, 1000));
            Check("full: the connection closed is the oldest one still waiting; none while all are answering",
                WebUi.OldestWaiting(new[] { false, true, true }) == 1 && WebUi.OldestWaiting(new[] { false, false }) == -1 && WebUi.OldestWaiting(new bool[0]) == -1);
            var f6 = fresh("launch");
            int o6 = 0, hooked = 0;
            var lw = WebUi.Launch(f6, new[] { "--web-port", "0" }, x => hooked++, win, direct, () => { o6++; return true; }, 20);
            try
            {
                Check("Launch: serves, takes over from the window, first start opens once and writes the flag",
                    lw != null && lw.Managing && hooked == 1 && lw.AutoOpened == "first" && o6 == 1 && f6.StatusPageShownBefore(), lw == null ? "no server" : lw.AutoOpened);
            }
            finally { if (lw != null) lw.Stop(); }
            var f7 = fresh("launch-no-browser");
            lw = WebUi.Launch(f7, new[] { "--web-port", "0", "--no-browser" }, x => hooked++, win, direct, () => { o6++; return true; }, 20);
            try { Check("Launch --no-browser: serves, opens nothing, no flag", lw != null && lw.AutoOpened == "off" && o6 == 1 && !f7.StatusPageShownBefore(), lw == null ? "no server" : lw.AutoOpened); }
            finally { if (lw != null) lw.Stop(); }
            Check("Launch --no-web or --shot: no server (the window as before)", WebUi.Launch(f7, new[] { "--no-web" }, x => hooked++, win, direct, () => true, 20) == null
                && WebUi.Launch(f7, new[] { "--shot", "x.png" }, x => hooked++, win, direct, () => true, 20) == null && hooked == 2);

            sb.AppendLine("-- status page: over a real socket");
            var live = Page(c, effects);
            bool started = live.Start(0);
            try
            {
                Check("listens on 127.0.0.1 only, unelevated", started && IPAddress.Loopback.Equals(live.BoundTo), live.BoundTo);
                Check("socket: bad Host refused", started && Raw(live.Port, "GET / HTTP/1.1\r\nHost: evil.example:" + live.Port + "\r\n\r\n").StartsWith("HTTP/1.1 403"));
                string ok = started ? Raw(live.Port, "GET /api/status HTTP/1.1\r\nHost: localhost:" + live.Port + "\r\n" + WebUi.TokenHeader + ": " + live.Token + "\r\n\r\n") : "";
                Check("socket: the status JSON", ok.StartsWith("HTTP/1.1 200") && ok.Contains("\"lights\""), Logic.Clip(ok, 80));
                Check("socket: a 1 MB body announced: 413", started && Raw(live.Port, "POST /api/action HTTP/1.1\r\nHost: localhost:" + live.Port + "\r\nContent-Length: 1048576\r\n\r\n").StartsWith("HTTP/1.1 413"));
                Check("socket: garbage: 400", started && Raw(live.Port, "\x16\x03\x01 hello\r\n\r\n").StartsWith("HTTP/1.1 400"));
                var second = Page(c, effects);
                Check("the port taken: a second server falls back to a free port", second.Start(live.Port) && second.Port != live.Port && second.Port > 0, second.Port);
                second.Stop();
                if (started) Sockets(live);
            }
            finally { live.Stop(); }
            try { Directory.Delete(tmp, true); } catch { }
        }

        // idle and slow sockets: they can't lock the page out, and the server gives up on them in time (about 11 s)
        static void Sockets(WebUi live)
        {
            string status = "GET /api/status HTTP/1.1\r\nHost: localhost:" + live.Port + "\r\n" + WebUi.TokenHeader + ": " + live.Token + "\r\n\r\n";
            var idle = new List<TcpClient>();
            try
            {
                for (int i = 0; i < 20; i++) { var t = new TcpClient(); t.Connect(IPAddress.Loopback, live.Port); idle.Add(t); }
                Thread.Sleep(200);
                string got = Raw(live.Port, status);
                Check("20 idle sockets open (spare browser connections, a stuck client): the page is still answered", got.StartsWith("HTTP/1.1 200"), Logic.Clip(got, 60));
            }
            finally { foreach (var t in idle) t.Close(); }
            Thread.Sleep(300);
            string half;
            using (var a = new TcpClient())
            {
                a.Connect(IPAddress.Loopback, live.Port);
                a.ReceiveTimeout = 5000;
                var sa = a.GetStream();
                var head = Encoding.ASCII.GetBytes(status);
                sa.Write(head, 0, 20);
                Thread.Sleep(150);
                string b1 = Raw(live.Port, status), b2 = Raw(live.Port, status);
                try { sa.Write(head, 20, head.Length - 20); half = ReadAll(sa); } catch (Exception e) { half = "error: " + e.Message; }
                Check("a request half sent while two others are answered: it is answered too", half.StartsWith("HTTP/1.1 200") && b1.StartsWith("HTTP/1.1 200") && b2.StartsWith("HTTP/1.1 200"), Logic.Clip(half, 60));
            }
            long silentMs = -1, trickleMs = -1;
            int silentGot = -2;
            string trickle = "";
            var silent = new Thread(() =>
            {
                try
                {
                    using (var cl = new TcpClient())
                    {
                        cl.Connect(IPAddress.Loopback, live.Port);
                        cl.ReceiveTimeout = 9000;
                        var sw = System.Diagnostics.Stopwatch.StartNew();
                        try { silentGot = cl.GetStream().Read(new byte[16], 0, 16); } catch (IOException) { silentGot = -1; }
                        silentMs = sw.ElapsedMilliseconds;
                    }
                }
                catch { }
            });
            var slow = new Thread(() =>
            {
                try
                {
                    using (var cl = new TcpClient())
                    {
                        cl.Connect(IPAddress.Loopback, live.Port);
                        cl.ReceiveTimeout = 16000;
                        var s = cl.GetStream();
                        var sw = System.Diagnostics.Stopwatch.StartNew();
                        bool stop = false;
                        var bytes = Encoding.ASCII.GetBytes("GET /api/status HTTP/1.1\r\nX-Pad: " + new string('a', 100));
                        var feed = new Thread(() => { try { for (int i = 0; i < bytes.Length && !stop; i++) { s.Write(bytes, i, 1); Thread.Sleep(700); } } catch { } });
                        feed.IsBackground = true;
                        feed.Start();
                        trickle = ReadAll(s);
                        stop = true;
                        trickleMs = sw.ElapsedMilliseconds;
                    }
                }
                catch { }
            });
            silent.Start(); slow.Start();
            silent.Join(20000); slow.Join(20000);
            Check("a socket that sends nothing is closed after the 5 s read timeout", silentGot == 0 && silentMs >= 4000 && silentMs < 8000, silentGot + " after " + silentMs + " ms");
            Check("a request trickling in (a byte every 0.7 s) gets 408 at the 10 s deadline", trickle.StartsWith("HTTP/1.1 408") && trickleMs >= 9000 && trickleMs < 14000, Logic.Clip(trickle, 40) + " after " + trickleMs + " ms");
        }

        // everything until the peer closes (or resets: what came before is kept)
        static string ReadAll(Stream s)
        {
            var ms = new MemoryStream();
            var buf = new byte[8192];
            try { int n; while ((n = s.Read(buf, 0, buf.Length)) > 0) ms.Write(buf, 0, n); }
            catch (IOException) { }
            catch (ObjectDisposedException) { }
            return Encoding.UTF8.GetString(ms.ToArray());
        }

        static string Raw(int port, string request)
        {
            try
            {
                using (var cl = new TcpClient())
                {
                    cl.Connect(IPAddress.Loopback, port);
                    cl.ReceiveTimeout = 5000;
                    var s = cl.GetStream();
                    var b = Encoding.ASCII.GetBytes(request);
                    s.Write(b, 0, b.Length);
                    var ms = new MemoryStream();
                    var buf = new byte[8192];
                    int n;
                    while ((n = s.Read(buf, 0, buf.Length)) > 0) ms.Write(buf, 0, n);
                    return Encoding.UTF8.GetString(ms.ToArray());
                }
            }
            catch (Exception e) { return "error: " + e.Message; }
        }
    }
}
