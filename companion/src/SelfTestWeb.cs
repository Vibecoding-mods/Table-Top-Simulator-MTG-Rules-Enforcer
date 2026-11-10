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
            resp = Send(w, Post(w, "{\"id\":\"restart-engine\"}", null));
            Check("POST without the token: 403, nothing done", resp.Status == 403 && ErrorId(resp) == "bad-token", resp.Body);
            resp = Send(w, Post(w, "{\"id\":\"restart-engine\"}", "deadbeef"));
            Check("POST with a bad token: 403", resp.Status == 403 && ErrorId(resp) == "bad-token", resp.Body);
            resp = Send(w, Post(w, "{\"id\":\"restart-engine\"}", w.Token, "", "text/plain"));
            Check("POST as text/plain (a form or no-cors fetch): 415", resp.Status == 415, resp.Body);
            resp = Send(w, Post(w, "{\"id\":\"open-logs\"}", w.Token, "").Replace("Origin: http://127.0.0.1:" + w.Port, "Origin: http://evil.example"));
            Check("POST with a cross-origin Origin and the token: 403, nothing done", resp.Status == 403 && ErrorId(resp) == "bad-origin" && effects.Count == 0, resp.Body);
            Check("POST not JSON: 400", Send(w, Post(w, "id=restart-engine", w.Token)).Status == 400);
            Check("POST JSON without an id: 400", Send(w, Post(w, "{\"x\":1}", w.Token)).Status == 400);
            Check("POST an unknown id: 400", Send(w, Post(w, "{\"id\":\"format-c\"}", w.Token)).Status == 400);
            Check("GET /api/action: 405", Send(w, Get(w, "/api/action", w.Token)).Status == 405);
            Check("POST /api/status: 405", Send(w, "POST /api/status HTTP/1.1\r\nHost: 127.0.0.1:48790\r\n" + WebUi.TokenHeader + ": " + w.Token + "\r\nContent-Length: 0\r\n\r\n").Status == 405);
            Check("DELETE /: 405", Send(w, "DELETE / HTTP/1.1\r\nHost: 127.0.0.1:48790\r\n\r\n").Status == 405);
            Check("an unknown path: 404; an unknown /api path without a token: 403", Send(w, Get(w, "/etc/passwd", null)).Status == 404 && Send(w, Get(w, "/api/x", null)).Status == 403);
            Check("a parse error is answered with its status", w.Handle(HttpReq.Fail(431, "big")).Status == 431);
            var wire = Encoding.ASCII.GetString(MiniHttp.Write(Send(w, Get(w, "/", null))));
            Check("answers: no-store, nosniff, frame DENY, Connection: close, no CORS header", wire.Contains("Cache-Control: no-store") && wire.Contains("X-Content-Type-Options: nosniff")
                && wire.Contains("X-Frame-Options: DENY") && wire.Contains("Connection: close") && !wire.Contains("Access-Control-Allow"));
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
            Check("status: the menu: restart-engine, stop-everything, open-logs, wsl-limits", menu != null && string.Join(",", menu.Select(m => J.Str(m, "id"))) == "restart-engine,stop-everything,open-logs,wsl-limits");
            Check("status: versions, a log with lines, update null (reserved)", J.Has(s, "versions") && J.Str(J.Get(s, "versions"), "companion") != null && J.Arr(J.Get(s, "log"), "lines") != null && J.Has(s, "update") && J.Get(s, "update") == null);

            sb.AppendLine("-- status page: actions go through the game lock");
            c.Game = Game.On("Game on: turn 6, 4 seats.", 6);
            s = J.Parse(Send(w, Get(w, "/api/status", w.Token)).Body);
            lights = J.Arr(s, "lights");
            game = J.Get(s, "game");
            Check("game on: status says locked, kind on, the lock sentence", J.Bool(game, "locked") && J.Str(game, "kind") == "on" && J.Str(game, "lockText") == Logic.LockText(c.Game), J.Write(game));
            Check("game on: the Restart relay and room button shows locked", J.Bool(J.Get(lights[2], "action"), "locked") && J.Bool(J.Get(lights[4], "action"), "locked") && !J.Bool(J.Get(lights[5], "action"), "locked"));
            Check("game on: Restart engine disabled in the menu", !J.Bool(J.Arr(s, "menu")[0], "enabled") && J.Str(J.Arr(s, "menu")[0], "label").Contains("locked"));
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

            sb.AppendLine("-- status page: when it opens by itself");
            Check("first start of a package: opens", WebUi.OpenAtStart(true, false, false));
            Check("later starts: not at start", !WebUi.OpenAtStart(true, false, true));
            Check("home mode and observe: not at start", !WebUi.OpenAtStart(false, false, false) && !WebUi.OpenAtStart(true, true, false));
            Check("after the first pass: only with a red light", WebUi.OpenAfterFirstPass(false, new[] { Light.Green, Light.Red }) && !WebUi.OpenAfterFirstPass(false, new[] { Light.Green, Light.Amber, Light.Busy }) && !WebUi.OpenAfterFirstPass(true, new[] { Light.Red }));
            var st = new Controller(Layout.Make(Mode.Friend, tmp), false, tmp, Path.Combine(tmp, "state"), "x.exe");
            bool before = st.StatusPageShownBefore();
            st.MarkStatusPageShown();
            Check("state.json: the flag is written once and read back", !before && st.StatusPageShownBefore() && J.Bool(J.Parse(File.ReadAllText(Path.Combine(tmp, "state", "state.json"))), "statusPageShown"));

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
            }
            finally { live.Stop(); }
            try { Directory.Delete(tmp, true); } catch { }
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
