// --selftest, own-server mode (OwnServer.cs, KeyVault.cs): the setting, the key at rest, the start light (the server's
// engine build too) and the bridge's environment, against canned inputs. `--selftest --section own-server` runs this section alone
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
            else if (name == "revert") RevertChecks();
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

            // ── the server's engine build against the table's (the owner's decision, 2026-11-17)
            var open = new LoginResult { Kind = LoginKind.Ok, RoomFound = true, RoomStatus = "Lobby", Ms = 42 };
            open.EngineBuild = "engine1121";
            v = OwnServer.Decide(ok, open, noGame, "engine1121");
            Check("build: the server's build is the table's: green", v.Light == Light.Green && v.Text.Contains("is open"), v);
            open.EngineBuild = "engine1120";
            v = OwnServer.Decide(ok, open, noGame, "engine1121");
            Check("build: another build than the table's: amber, both named, ask the host", v.Light == Light.Amber && v.Text.Contains("engine1120") && v.Text.Contains("engine1121") && v.Text.Contains("ask the host"), v);
            v = OwnServer.Decide(ok, new LoginResult { Kind = LoginKind.Ok, RoomFound = true, RoomStatus = "InGame", EngineBuild = "engine1120" }, Game.On("a game", 3), "engine1121");
            Check("build: another build during our own game: amber too", v.Light == Light.Amber, v);
            open.EngineBuild = null;
            v = OwnServer.Decide(ok, open, noGame, "engine1121");
            Check("build: a server too old to say: green, no warning", v.Light == Light.Green, v);
            open.EngineBuild = "engine1121";
            v = OwnServer.Decide(ok, open, noGame, null);
            Check("build: a deploy too old to say: green, no warning", v.Light == Light.Green, v);

            // ── the key at rest: encrypted for this Windows account (DPAPI), a plain key re-saved encrypted once
            Func<string, string> seal = k => "sealed:" + new string(k.Reverse().ToArray());
            Func<string, string> unseal = b => { if (!b.StartsWith("sealed:")) throw new InvalidOperationException("not ours"); return new string(b.Substring(7).Reverse().ToArray()); };
            string resave, problem;
            var plainFile = "{\"host\":\"mtg.example.org\",\"port\":9555,\"key\":\"" + Key + "\"}";
            var opened = OwnServer.OpenKey(plainFile, unseal, seal, out resave, out problem);
            var used = OwnServer.SettingOf(opened, null, null);
            Check("key: a plain key is used as it is", problem == null && used != null && used.Ok && used.Server.Key == Key && used.Server.Port == 9555, Show(used));
            Check("key: and the file is saved again with it encrypted, never plain", resave != null && !resave.Contains(Key) && resave.Contains("\"" + KeyVault.Field + "\"") && resave.Contains("9555"), resave);
            var resaved = resave;
            opened = OwnServer.OpenKey(resaved, unseal, seal, out resave, out problem);
            used = OwnServer.SettingOf(opened, null, null);
            Check("key: the encrypted file opens to the same key, and isn't saved again", problem == null && resave == null && used != null && used.Ok && used.Server.Key == Key && used.Server.Host == "mtg.example.org", Show(used));
            opened = OwnServer.OpenKey(resaved, b => { throw new InvalidOperationException("another account"); }, seal, out resave, out problem);
            Check("key: another account's encrypted key: a problem that says to put the key in again", opened == null && problem != null && problem.Contains("another Windows account") && problem.Contains("\"key\""), problem);
            opened = OwnServer.OpenKey(resaved.Replace("{", "{\"key\":\"new-key-0123\","), unseal, seal, out resave, out problem);
            used = OwnServer.SettingOf(opened, null, null);
            Check("key: a key typed beside an encrypted one wins, and replaces it encrypted", used != null && used.Ok && used.Server.Key == "new-key-0123" && resave != null && !resave.Contains("new-key-0123") && resave.Split(new[] { KeyVault.Field }, StringSplitOptions.None).Length == 2, resave);
            opened = OwnServer.OpenKey(plainFile, unseal, k => { throw new InvalidOperationException("no DPAPI"); }, out resave, out problem);
            Check("key: encryption failing keeps the plain file (nothing saved) and still plays", resave == null && problem == null && OwnServer.SettingOf(opened, null, null).Ok, Show(OwnServer.SettingOf(opened, null, null)));
            opened = OwnServer.OpenKey("{ \"host\": ", unseal, seal, out resave, out problem);
            Check("key: a broken file is handed on for SettingOf to explain", opened == "{ \"host\": " && resave == null && problem == null && !OwnServer.SettingOf(opened, null, null).Ok);
            Check("key: no file: nothing", OwnServer.OpenKey(null, unseal, seal, out resave, out problem) == null && resave == null && problem == null);
            string real = null;
            try { real = KeyVault.Protect(Key); } catch (Exception e) { real = "error: " + e.Message; }
            string back = null;
            try { back = KeyVault.Unprotect(real); } catch (Exception e) { back = "error: " + e.Message; }
            bool? machine = null;
            try { machine = KeyVault.MachineScoped(Convert.FromBase64String(real)); } catch { machine = null; }
            Check("key: DPAPI (ProtectedData, CurrentUser) round trip, the blob never the key", back == Key && !real.Contains(Key) && machine != true,
                real + " -> " + back + (machine == true ? " (a blob for the machine, not this account)" : machine == false ? " (this account's blob)" : " (not a Windows DPAPI blob: scope read from the round trip only)"));
            // (the scope reader itself, on made-up Windows-shaped blobs)
            Func<uint, byte[]> shaped = f => { var x = new byte[60]; x[0] = 1; new byte[] { 0xd0, 0x8c, 0x9d, 0xdf, 0x01, 0x15, 0xd1, 0x11, 0x8c, 0x7a, 0x00, 0xc0, 0x4f, 0xc2, 0x97, 0xeb }.CopyTo(x, 4); BitConverter.GetBytes(f).CopyTo(x, 40); return x; };
            Check("key: the scope reader: an account's blob, a machine's, and a blob that isn't Windows'",
                KeyVault.MachineScoped(shaped(0)) == false && KeyVault.MachineScoped(shaped(4)) == true && KeyVault.MachineScoped(shaped(0x20000004)) == true
                && KeyVault.MachineScoped(new byte[60]) == null && KeyVault.MachineScoped(new byte[10]) == null);
            OwnServerWiring(Key);
        }

        // The Controller and the page's API with a server.json in a temp package: the row's name, the bridge loop's
        // environment, the plain key saved again encrypted, no Own server box on the page, and the key never in the
        // status JSON or the log. (The bridge URL points at nothing, so no game locks it.)
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
                Check("wiring: the status JSON has no server part (no box) and never the key", !J.Has(J.Parse(status), "server") && !status.Contains(key), Logic.Clip(status, 200));
                var stored = Probes.ReadText(l.ServerFile) ?? "";
                Check("wiring: the plain key in server.json is saved again encrypted for this account", !stored.Contains(key) && stored.Contains("\"" + KeyVault.Field + "\"") && stored.Contains("9555"), stored);
                var again = new Controller(l, true, Path.Combine(tmp, "saves"), Path.Combine(tmp, "state"), "x.exe");
                Check("wiring: the encrypted server.json opens to the same key", again.Server != null && again.Server.Ok && again.Server.Server.Key == key && again.BridgeLoopInfo().EnvironmentVariables["MTG_KEY"] == key, Show(again.Server));
                var gone = Send(w, PostTo(w, "/api/server", "{\"local\":true}", w.Token));
                Check("wiring: POST /api/server is gone (no box): not found, server.json kept", gone.Status == 404 && File.Exists(l.ServerFile), gone.Status);
                var page = Send(w, Get(w, "/", null)).Body ?? "";
                Check("wiring: the page has no Own server box", !page.Contains("srvbox") && !page.Contains("/api/server"), Logic.Clip(page, 120));
                File.WriteAllText(l.ServerFile, "{\"host\":\"mtg.example.org\",\"key\":\"" + key + "\"}");
                var watcher = new Controller(l, true, Path.Combine(tmp, "saves"), Path.Combine(tmp, "state"), "x.exe");
                Check("wiring: observe mode leaves a plain key as it is (nothing written)", watcher.Server != null && watcher.Server.Ok && Probes.ReadText(l.ServerFile).Contains(key));
                var realProtect = Controller.KeyProtect;
                try
                {
                    Controller.KeyProtect = k => { throw new System.Security.Cryptography.CryptographicException("DPAPI unavailable"); };
                    var failing = new Controller(l, false, Path.Combine(tmp, "saves"), Path.Combine(tmp, "state"), "x.exe");
                    var said = Probes.ReadText(Log.File) ?? "";
                    Check("wiring: encryption failing is logged once (no key), the file kept, the server still used",
                        said.Contains("the key couldn't be encrypted for this Windows account (CryptographicException: DPAPI unavailable)") && !said.Contains(key)
                        && Probes.ReadText(l.ServerFile).Contains(key) && failing.Server != null && failing.Server.Ok, Logic.Clip(said, 300));
                }
                finally { Controller.KeyProtect = realProtect; }
                File.Delete(l.ServerFile);
                var local = new Controller(l, true, Path.Combine(tmp, "saves"), Path.Combine(tmp, "state"), "x.exe");
                psi = local.BridgeLoopInfo();
                Check("wiring: no server.json: Engine stack, and the bridge's server variables emptied", local.Rows[Controller.StepStack].Name == Controller.Names[Controller.StepStack] && psi.EnvironmentVariables["MTG_RELAY"] == "" && psi.EnvironmentVariables["MTG_REMOTE_ENGINE"] == "", psi.EnvironmentVariables["MTG_RELAY"]);
                var logText = Probes.ReadText(Log.File) ?? "";
                Check("wiring: the key is never in the log, and the encryption is", !logText.Contains(key) && logText.Contains("now encrypted for this Windows account"), Logic.Clip(logText, 300));
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
