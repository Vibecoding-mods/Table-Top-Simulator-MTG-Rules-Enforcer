// --selftest, own-server mode (OwnServer.cs): the setting, the start light, the bridge's environment and the status
// page's box, against canned inputs. `--selftest --section own-server` runs this section alone
// (tests/test_companion_own_server.js does, and tools/mutate-companion-own-server.js breaks the rules one at a time).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Sockets;
using System.Text;

namespace MtgCompanion
{
    public static partial class SelfTest
    {
        // one section by name (--section); an unknown name fails
        public static int RunSection(StringBuilder output, string name)
        {
            sb = output; fails = 0; passes = 0;
            if (name == "own-server") OwnServerChecks();
            else Check("--section " + name + ": a section of the self-test", false, "unknown section");
            sb.AppendLine(passes + " passed, " + fails + " failed");
            return fails;
        }

        static void OwnServerChecks()
        {
            sb.AppendLine("== own server");
            const string Key = "k3y-from-the-host-01";
            // ── server.json and --server
            Check("server: no file and no --server: this computer's engine", OwnServer.SettingOf(null, null, null) == null);
            var s = OwnServer.SettingOf("{\"host\":\"MTG.Example.org\",\"key\":\"" + Key + "\"}", null, null);
            Check("server: host only, the default port 9443, lower case", s != null && s.Ok && s.Server.Host == "mtg.example.org" && s.Server.Port == 9443 && s.Server.Key == Key && !s.Server.Secure, Show(s));
            s = OwnServer.SettingOf("﻿{\"host\":\"10.0.0.5\",\"port\":9555,\"key\":\"" + Key + "\",\"secure\":true}", null, null);
            Check("server: a port, secure, and Notepad's BOM", s != null && s.Ok && s.Server.Port == 9555 && s.Server.Secure && OwnServer.Url(s.Server) == "wss://10.0.0.5:9555", Show(s));
            s = OwnServer.SettingOf("{\"host\":\"[fd7a:115c::1]\",\"port\":\"9443\",\"key\":\"" + Key + "\"}", null, null);
            Check("server: an IPv6 address in brackets, the port as text", s != null && s.Ok && s.Server.Host == "[fd7a:115c::1]" && s.Server.Port == 9443, Show(s));
            foreach (var bad in new[] {
                new[] { "{\"host\":\"ws://mtg.example.org\",\"key\":\"x\"}", "without ws://" },
                new[] { "{\"host\":\"mtg example\",\"key\":\"x\"}", "isn't a server name" },
                new[] { "{\"port\":9443,\"key\":\"x\"}", "\"host\" is missing" },
                new[] { "{\"host\":\"a.b\",\"port\":70000,\"key\":\"x\"}", "1 to 65535" },
                new[] { "{\"host\":\"a.b\",\"port\":0,\"key\":\"x\"}", "1 to 65535" },
                new[] { "{\"host\":\"a.b\",\"prot\":9443,\"key\":\"x\"}", "unknown setting \"prot\"" },
                new[] { "{\"host\":\"a.b\",\"key\":\"  \"}", "\"key\" must be" },
                new[] { "{\"host\":\"a.b\",\"key\":\"x\",\"secure\":\"yes\"}", "\"secure\" must be true or false" },
                new[] { "{\"host\": ", "isn't valid JSON" },
                new[] { "{\"host\":\"a.b\",\"key\":\"x\"", "isn't valid JSON" },
                new[] { "{\"host\":\"a.b\",\"key\":\"x\",", "isn't valid JSON" },
                new[] { "{\"host\":\"a.b\",\"key\":\"x\"} junk", "isn't valid JSON" },
                new[] { "false", "isn't a JSON object" } })
            {
                var r = OwnServer.SettingOf(bad[0], null, null);
                Check("server: refused (" + bad[1] + ")", r != null && !r.Ok && r.Problem.Contains(bad[1]), Show(r));
            }
            s = OwnServer.SettingOf("{\"host\":\"mtg.example.org\"}", null, null);
            Check("server: no key: refused, and never this package's own key", s != null && !s.Ok && s.NoKey && s.Problem.Contains("MANABREW_SERVER_KEY"), Show(s));
            s = OwnServer.SettingOf("{\"host\":\"mtg.example.org\"}", null, "env-key-123456");
            Check("server: MTG_SERVER_KEY gives a key server.json leaves out", s != null && s.Ok && s.Server.Key == "env-key-123456", Show(s));
            s = OwnServer.SettingOf("{\"host\":\"mtg.example.org\",\"key\":\"" + Key + "\"}", null, "env-key-123456");
            Check("server: server.json's key beats MTG_SERVER_KEY", s != null && s.Ok && s.Server.Key == Key, Show(s));
            s = OwnServer.SettingOf(null, "other.example.org:9600", "env-key-123456");
            Check("server: --server HOST:PORT alone, with MTG_SERVER_KEY", s != null && s.Ok && s.Server.Host == "other.example.org" && s.Server.Port == 9600, Show(s));
            s = OwnServer.SettingOf("{\"host\":\"mtg.example.org\",\"port\":9555,\"key\":\"" + Key + "\"}", "mtg.example.org", null);
            Check("server: --server for the file's host keeps its port and key", s != null && s.Ok && s.Server.Port == 9555 && s.Server.Key == Key, Show(s));
            s = OwnServer.SettingOf("{\"host\":\"mtg.example.org\",\"key\":\"" + Key + "\"}", "other.example.org", null);
            Check("server: --server for another host never gets the file's key", s != null && !s.Ok && s.NoKey && s.Problem.Contains("isn't sent to another server"), Show(s));

            // ── the start light
            var ok = OwnServer.SettingOf("{\"host\":\"mtg.example.org\",\"key\":\"" + Key + "\"}", null, null);
            var noGame = Game.None("no game");
            Func<LoginKind, LoginResult> login = k => new LoginResult { Kind = k, Detail = "detail" };
            var v = OwnServer.Decide(ok, new LoginResult { Kind = LoginKind.Ok, RoomFound = true, RoomStatus = "Lobby", Ms = 42 }, noGame);
            Check("light: the server answers, the room is open: green", v.Light == Light.Green && v.Text.Contains("answers") && v.Text.Contains("mtg.example.org:9443"), v);
            v = OwnServer.Decide(ok, new LoginResult { Kind = LoginKind.Ok, RoomFound = true, RoomStatus = "InGame" }, Game.On("a game", 3));
            Check("light: the room in our game: green", v.Light == Light.Green && v.Text.Contains("in a game"), v);
            v = OwnServer.Decide(ok, new LoginResult { Kind = LoginKind.Ok, RoomFound = true, RoomStatus = "InGame" }, noGame);
            Check("light: the room busy with an earlier game: red", v.Light == Light.Red && v.Text.Contains("busy") && v.Fix == Fixes.Retry, v);
            v = OwnServer.Decide(ok, new LoginResult { Kind = LoginKind.Ok, RoomFound = false }, noGame);
            Check("light: no Forge room on the server: red", v.Light == Light.Red && v.Text.Contains("isn't open"), v);
            foreach (var c in new[] { new object[] { LoginKind.AuthFailed, "refused the key" }, new object[] { LoginKind.Refused, "nothing listens on port 9443" },
                new object[] { LoginKind.NotFound, "isn't known" }, new object[] { LoginKind.Timeout, "didn't answer" }, new object[] { LoginKind.Closed, "Can't reach your server" } })
            {
                v = OwnServer.Decide(ok, login((LoginKind)c[0]), noGame);
                Check("light: " + c[0] + ": red, says " + c[1] + ", Try again", v.Light == Light.Red && v.Text.Contains((string)c[1]) && v.Fix == Fixes.Retry && v.Hint != null, v);
            }
            v = OwnServer.Decide(ok, new LoginResult { Kind = LoginKind.Skipped }, Game.On("a game", 3));
            Check("light: not asked during a game: green, says so", v.Light == Light.Green && v.Text.Contains("not probed during a game"), v);
            v = OwnServer.Decide(OwnServer.SettingOf("{\"host\":\"mtg.example.org\"}", null, null), null, noGame);
            Check("light: a setting with a problem: red, the problem, Try again", v.Light == Light.Red && v.Text.StartsWith("Own server: no key") && v.Fix == Fixes.Retry, v);
            v = OwnServer.NotNeeded(ok.Server);
            Check("light: Docker and the images aren't needed here: green", v.Light == Light.Green && v.Text.Contains("Not needed here") && v.Text.Contains("mtg.example.org:9443"), v);
            Check("light: the engine counts as up with a server (the rows as the controller sets them)", Logic.EngineUp(new List<Light> { Light.Green, Light.Green, Light.Green, Light.Grey, Light.Green, Light.Amber }));

            // ── the bridge: its relay, key and remote mode
            var env = OwnServer.BridgeEnv(ok.Server);
            Check("bridge: started with the server's relay, key and MTG_REMOTE_ENGINE=1", Val(env, "MTG_RELAY") == "ws://mtg.example.org:9443" && Val(env, "MTG_KEY") == Key && Val(env, "MTG_REMOTE_ENGINE") == "1", J.Write(env));
            env = OwnServer.BridgeEnv(null);
            Check("bridge: this computer's engine empties the three", Val(env, "MTG_RELAY") == "" && Val(env, "MTG_KEY") == "" && Val(env, "MTG_REMOTE_ENGINE") == "", J.Write(env));
            Check("bridge: one running for this PC's engine differs from the server", OwnServer.RelayDiffers("{\"relay\":\"ws://127.0.0.1:9443\",\"remoteEngine\":false}", ok.Server));
            Check("bridge: one running for the server doesn't", !OwnServer.RelayDiffers("{\"relay\":\"ws://mtg.example.org:9443\",\"remoteEngine\":true}", ok.Server));
            Check("bridge: one too old to say differs from a server", OwnServer.RelayDiffers("{\"bridge\":\"abc\"}", ok.Server));
            Check("bridge: one running for a server differs from this PC's engine", OwnServer.RelayDiffers("{\"relay\":\"ws://mtg.example.org:9443\",\"remoteEngine\":true}", null));
            Check("bridge: this PC's bridge for this PC's engine doesn't", !OwnServer.RelayDiffers("{\"relay\":\"ws://127.0.0.1:9443\",\"remoteEngine\":false}", null));
            v = OwnServer.BridgeForOtherEngine(ok.Server);
            Check("bridge: for another engine: amber, Restart the bridge", v.Light == Light.Amber && v.Fix == Fixes.BridgeRestart, v);

            // ── the status page's box: never the key
            var view = OwnServer.View(ok);
            var shown = J.Write(view);
            Check("page: the server, its port, a key is set, its last 2 characters only", (string)view["mode"] == "server" && (string)view["host"] == "mtg.example.org" && (bool)view["keySet"] && (string)view["keyEnds"] == "01" && !shown.Contains(Key), shown);
            Check("page: this computer's engine", (string)OwnServer.View(null)["mode"] == "local");
            Check("page: a short key shows no characters", OwnServer.KeyEnds("abc") == "");
            string problem;
            var text = OwnServer.FileFromBox("MTG.example.org:9600", " " + Key + " ", false, null, out problem);
            var back = OwnServer.SettingOf(text, null, null);
            Check("page: Use this server writes a server.json the companion reads back", problem == null && back != null && back.Ok && back.Server.Host == "mtg.example.org" && back.Server.Port == 9600 && back.Server.Key == Key, problem ?? text);
            text = OwnServer.FileFromBox("mtg.example.org:9600", "", true, "{\"host\":\"mtg.example.org\",\"key\":\"" + Key + "\"}", out problem);
            back = OwnServer.SettingOf(text, null, null);
            Check("page: a blank key keeps server.json's for the same host", problem == null && back != null && back.Ok && back.Server.Key == Key && back.Server.Secure, problem ?? text);
            text = OwnServer.FileFromBox("other.example.org", "", false, "{\"host\":\"mtg.example.org\",\"key\":\"" + Key + "\"}", out problem);
            Check("page: a blank key for another host is refused (the old key isn't sent there)", text == null && problem != null && problem.Contains("key"), problem);
            text = OwnServer.FileFromBox("ws://mtg.example.org", Key, false, null, out problem);
            Check("page: a bad address is refused with the reason, nothing written", text == null && problem != null && problem.Contains("without ws://"), problem);
            text = OwnServer.FileFromBox("", Key, false, null, out problem);
            Check("page: no address: asks for one", text == null && problem != null && problem.Contains("address"), problem);
            // ── what a failed connect says (Probes.ConnectFailureKind), from each platform's exceptions: .NET Framework on
            // Windows reports an unknown name as a WebException (NameResolutionFailure) with no SocketException, mono as a
            // SocketException (HostNotFound). Checked here with both shapes, so neither branch is only seen on one platform.
            Func<Exception, LoginKind> kind = Probes.ConnectFailureKind;
            Func<SocketError, Exception> sock = (code) => new System.Net.Sockets.SocketException((int)code);
            Check("login kind: Windows' unknown name (WebException NameResolutionFailure): isn't known",
                kind(new AggregateException(new System.Net.WebSockets.WebSocketException("x", new System.Net.WebException("The remote name could not be resolved", System.Net.WebExceptionStatus.NameResolutionFailure)))) == LoginKind.NotFound);
            Check("login kind: mono's unknown name (SocketException HostNotFound): isn't known",
                kind(new AggregateException(new System.Net.WebException("x", sock(SocketError.HostNotFound)))) == LoginKind.NotFound);
            Check("login kind: no address for the name (NoData, TryAgain): isn't known",
                kind(sock(SocketError.NoData)) == LoginKind.NotFound && kind(sock(SocketError.TryAgain)) == LoginKind.NotFound);
            Check("login kind: a refused connection: refused",
                kind(new AggregateException(new System.Net.WebException("x", sock(SocketError.ConnectionRefused)))) == LoginKind.Refused);
            Check("login kind: another WebException: closed, not isn't known",
                kind(new System.Net.WebException("x", System.Net.WebExceptionStatus.ConnectFailure)) == LoginKind.Closed);
            Check("login kind: cancelled: timeout", kind(new AggregateException(new System.Threading.Tasks.TaskCanceledException())) == LoginKind.Timeout);
            OwnServerWiring(Key);
        }

        // The Controller and the page's API with a server.json in a temp package: the row's name, the bridge loop's
        // environment, Use this server / Use this computer through POST /api/server, and the key never in the status
        // JSON or the log. (The bridge URL points at nothing, so no game locks it.)
        static void OwnServerWiring(string key)
        {
            var tmp = Path.Combine(Path.GetTempPath(), "mtg-companion-selftest-server-" + Guid.NewGuid().ToString("N").Substring(0, 8));
            var realBridge = Controller.BridgeUrl; var realLog = Log.File;
            try
            {
                Directory.CreateDirectory(tmp);
                Controller.BridgeUrl = "http://127.0.0.1:9";
                Log.File = Path.Combine(tmp, "companion.log");
                var l = Layout.Make(Mode.Friend, tmp);
                File.WriteAllText(l.ServerFile, "{\"host\":\"mtg.example.org\",\"port\":9555,\"key\":\"" + key + "\"}");
                var c = new Controller(l, false, Path.Combine(tmp, "saves"), Path.Combine(tmp, "state"), "x.exe");
                // (the start steps themselves, without the watcher: steps 1 and 2 only, read only)
                var steps = new Controller(l, true, Path.Combine(tmp, "saves"), Path.Combine(tmp, "state"), "x.exe");
                steps.OnlySteps = new HashSet<int> { 1, 2 };
                steps.RunSequence(1);
                Check("wiring: with a server the start steps ask nothing of Docker: Not needed here", steps.Rows[Controller.StepDocker].V.Text.StartsWith("Not needed here") && steps.Rows[Controller.StepImages].V.Text.StartsWith("Not needed here"), steps.Rows[Controller.StepDocker].V + " | " + steps.Rows[Controller.StepImages].V);
                Check("wiring: server.json makes the Engine stack row Your server", c.Rows[Controller.StepStack].Name == OwnServer.RowName && c.Server != null && c.Server.Ok, c.Rows[Controller.StepStack].Name);
                var psi = c.BridgeLoopInfo();
                Check("wiring: the bridge loop gets the server's relay, key and MTG_REMOTE_ENGINE=1",
                    psi.EnvironmentVariables["MTG_RELAY"] == "ws://mtg.example.org:9555" && psi.EnvironmentVariables["MTG_KEY"] == key && psi.EnvironmentVariables["MTG_REMOTE_ENGINE"] == "1", psi.EnvironmentVariables["MTG_RELAY"]);
                var effects = new List<string>();
                var w = Page(c, effects);
                var status = Send(w, Get(w, "/api/status", w.Token)).Body;
                Check("wiring: the status JSON has the server, never its key", J.Str(J.Get(J.Parse(status), "server"), "mode") == "server" && !status.Contains(key), Logic.Clip(status, 200));
                var res = J.Parse(Send(w, PostTo(w, "/api/server", "{\"local\":true}", w.Token)).Body);
                Check("wiring: Use this computer removes server.json", J.Bool(res, "ok") && !File.Exists(l.ServerFile), J.Write(res));
                res = J.Parse(Send(w, PostTo(w, "/api/server", "{\"host\":\"10.0.0.7:9600\",\"key\":\"" + key + "\",\"secure\":false}", w.Token)).Body);
                var back = OwnServer.SettingOf(Probes.ReadText(l.ServerFile), null, null);
                Check("wiring: Use this server writes server.json", J.Bool(res, "ok") && back != null && back.Ok && back.Server.Host == "10.0.0.7" && back.Server.Port == 9600 && back.Server.Key == key, J.Write(res));
                res = J.Parse(Send(w, PostTo(w, "/api/server", "{\"host\":\"ws://x\",\"key\":\"k\"}", w.Token)).Body);
                Check("wiring: a bad address is refused, server.json unchanged", !J.Bool(res, "ok") && Probes.ReadText(l.ServerFile).Contains("10.0.0.7"), J.Write(res));
                var noToken = Send(w, PostTo(w, "/api/server", "{\"local\":true}", null));
                Check("wiring: POST /api/server without the page's token is refused", noToken.Status == 403 && File.Exists(l.ServerFile), noToken.Status);
                File.Delete(l.ServerFile);
                var local = new Controller(l, true, Path.Combine(tmp, "saves"), Path.Combine(tmp, "state"), "x.exe");
                psi = local.BridgeLoopInfo();
                Check("wiring: no server.json: Engine stack, and the bridge's server variables emptied", local.Rows[Controller.StepStack].Name == Controller.Names[Controller.StepStack] && psi.EnvironmentVariables["MTG_RELAY"] == "" && psi.EnvironmentVariables["MTG_REMOTE_ENGINE"] == "", psi.EnvironmentVariables["MTG_RELAY"]);
                Check("wiring: observe mode changes no server", local.SetServer("{}") != null && !File.Exists(l.ServerFile));
                var logText = Probes.ReadText(Log.File) ?? "";
                Check("wiring: the key is never in the log", !logText.Contains(key) && logText.Contains("own server"), Logic.Clip(logText, 300));
            }
            catch (Exception e) { Check("wiring: no exception", false, e.ToString()); }
            finally
            {
                Controller.BridgeUrl = realBridge; Log.File = realLog;
                try { Directory.Delete(tmp, true); } catch { }
            }
        }

        static string PostTo(WebUi w, string path, string json, string token)
        {
            return Post(w, json, token).Replace("POST /api/action ", "POST " + path + " ");
        }

        // a value of the bridge's environment, null when it isn't set
        static string Val(Dictionary<string, string> d, string k) { string v; return d != null && d.TryGetValue(k, out v) ? v : null; }

        // a setting as the checks print it, without its key
        static string Show(ServerSetting s)
        {
            if (s == null) return "null";
            if (!s.Ok) return "problem: " + s.Problem;
            return OwnServer.Url(s.Server) + (s.Server.Key != null ? " (a key)" : " (no key)");
        }
    }
}
