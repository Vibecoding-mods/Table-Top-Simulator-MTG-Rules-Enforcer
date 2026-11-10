// --selftest: the decision logic against canned inputs. Prints one line per case; the exit code is the failure count.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace MtgCompanion
{
    public static partial class SelfTest
    {
        static StringBuilder sb;
        static int fails, passes;

        static void Check(string name, bool ok, object got)
        {
            if (ok) passes++; else fails++;
            sb.AppendLine((ok ? "PASS " : "FAIL ") + name + (ok ? "" : "   got: " + got));
        }

        static void Check(string name, bool ok) { Check(name, ok, "(false)"); }

        public static int Run(StringBuilder output)
        {
            sb = output; fails = 0; passes = 0;
            Modes(); Docker(); Images(); Stack(); Ports(); Bridge(); GameLock(); Saves(); Tts(); Wsl(); Misc(); Update(); UpdateSafety();
            sb.AppendLine(passes + " passed, " + fails + " failed");
            return fails;
        }

        static Func<string, bool> Files(params string[] present)
        {
            var set = new HashSet<string>(present.Select(p => p.ToLowerInvariant()));
            return p => set.Contains(p.ToLowerInvariant());
        }

        static void Modes()
        {
            sb.AppendLine("-- home vs friend mode");
            var l = Logic.DetectLayout(@"D:\MTG-Table", Files(@"D:\MTG-Table\version.json", @"D:\MTG-Table\bridge\bridge.js"), null);
            Check("friend: version.json beside the exe", l != null && l.Mode == Mode.Friend && l.Home == @"D:\MTG-Table", l == null ? null : l.Mode.ToString());
            Check("friend: bundled node, project mtg-table, logs\\", l != null && l.NodeExe == @"D:\MTG-Table\runtime\node\node.exe" && l.Project == "mtg-table" && l.CompanionLog == @"D:\MTG-Table\logs\companion.log" && l.BridgeLog == @"D:\MTG-Table\logs\bridge.log");
            Check("friend: compose and table paths", l != null && l.ComposeFile == @"D:\MTG-Table\stack\compose.yml" && l.TableJson == @"D:\MTG-Table\table\MTG Table.json");
            l = Logic.DetectLayout(@"C:\r\companion\bin", Files(@"C:\r\bridge\bridge.js", @"C:\r\Start MTG.bat"), null);
            Check("home: exe in companion\\bin finds the repo two levels up", l != null && l.Mode == Mode.Home && l.Home == @"C:\r", l == null ? null : l.Home);
            Check("home: node on PATH, project stack, tmp\\ logs", l != null && l.NodeExe == "node" && l.Project == "stack" && l.BridgeLog == @"C:\r\tmp\bridge-live.log");
            l = Logic.DetectLayout(@"C:\r", Files(@"C:\r\bridge\bridge.js", @"C:\r\Start MTG.bat"), null);
            Check("home: exe in the repo root", l != null && l.Mode == Mode.Home);
            l = Logic.DetectLayout(@"C:\r\dist\MTG-Table", Files(@"C:\r\dist\MTG-Table\version.json", @"C:\r\bridge\bridge.js", @"C:\r\Start MTG.bat"), null);
            Check("a package inside a repo is friend mode", l != null && l.Mode == Mode.Friend && l.Home == @"C:\r\dist\MTG-Table");
            l = Logic.DetectLayout(@"C:\Downloads", Files(@"C:\Downloads\bridge\bridge.js"), null);
            Check("bridge.js without Start MTG.bat or version.json: no layout", l == null);
            l = Logic.DetectLayout(@"C:\x", Files(@"C:\r\bridge\bridge.js", @"C:\r\Start MTG.bat"), @"C:\r");
            Check("--home points at the repo", l != null && l.Mode == Mode.Home && l.Home == @"C:\r");
            string tar = Logic.FindImagesTar(@"D:\P", Files(@"D:\P\images\mtg-images.tar.gz"), d => new string[0]);
            Check("images: .tar.gz accepted", tar == @"D:\P\images\mtg-images.tar.gz", tar);
            tar = Logic.FindImagesTar(@"D:\P", Files(), d => new[] { @"D:\P\images\engine-2026.tar" });
            Check("images: any .tar in images\\", tar == @"D:\P\images\engine-2026.tar", tar);
        }

        static void Docker()
        {
            sb.AppendLine("-- Docker");
            var v = Logic.DecideDocker(new DockerFacts());
            Check("missing: red, says Install Docker Desktop with the address", v.Light == Light.Red && v.Text.Contains("Install Docker Desktop") && v.Text.Contains("docker.com") && v.Fix == Fixes.Retry, v);
            Check("missing: no action (no auto-download)", v.Action == null, v);
            v = Logic.DecideDocker(new DockerFacts { CliFound = true, DesktopFound = true });
            Check("installed, not running: start Docker Desktop", v.Action == Actions.StartDesktop && v.Light == Light.Busy, v);
            v = Logic.DecideDocker(new DockerFacts { CliFound = true, DesktopFound = true, Waiting = true, WaitedSec = 40 });
            Check("starting (40 s): keep waiting", v.Light == Light.Busy && v.Action == Actions.Wait, v);
            v = Logic.DecideDocker(new DockerFacts { CliFound = true, DesktopFound = true, DesktopRunning = true });
            Check("Docker Desktop process up, engine not yet: wait, don't start a second one", v.Action == Actions.Wait, v);
            v = Logic.DecideDocker(new DockerFacts { CliFound = true, DesktopFound = true, Waiting = true, WaitedSec = 181 });
            Check("not answering after 3 minutes: red, Start Docker Desktop", v.Light == Light.Red && v.Fix == Fixes.DockerStart, v);
            v = Logic.DecideDocker(new DockerFacts { CliFound = true, DesktopFound = true, Answers = true, OsType = "linux", Version = "29.8.2", Cpus = 2 });
            Check("running: green with version and CPUs", v.Light == Light.Green && v.Text.Contains("29.8.2") && v.Text.Contains("2 CPUs"), v);
            v = Logic.DecideDocker(new DockerFacts { CliFound = true, DesktopFound = true, Answers = true, OsType = "windows" });
            Check("Windows containers mode: red, says switch", v.Light == Light.Red && v.Text.Contains("Linux containers"), v);
            v = Logic.DecideDocker(new DockerFacts { CliFound = true });
            Check("CLI but no Docker Desktop: red, no start", v.Light == Light.Red && v.Action == null, v);
            v = Logic.DecideDocker(new DockerFacts { CliFound = true, DesktopFound = true, DesktopRunning = true, AccessDenied = true });
            Check("pipe refuses this account: red, sign out and back in, not 'starting'", v.Light == Light.Red && v.Text.Contains("sign out of Windows") && v.Fix == Fixes.Retry && v.Action == null, v);
            v = Logic.DecideDocker(new DockerFacts { CliFound = true, DesktopFound = true, Answers = true, OsType = "linux", AccessDenied = true });
            Check("answers: green even if an earlier probe was refused", v.Light == Light.Green, v);
        }

        const string R = "sha256:dbfe69213fff7e3eccb6db806e09afbec608e7c56105020d70e3b8ac631e74b3";
        const string N = "sha256:ef61822078a04ba83bd1086449a2a92b3860ac3d377444a2da658e1ee781c0f6";

        static void Images()
        {
            sb.AppendLine("-- engine images");
            var v = Logic.DecideImages(new ImageFacts { Friend = true, TarPath = "x.tar", WantRelay = R, WantNode = N });
            Check("missing: load from the tar", v.Action == Actions.Load && v.Text.StartsWith("Loading"), v);
            v = Logic.DecideImages(new ImageFacts { Friend = true, TarPath = "x.tar", RelayId = R, NodeId = "sha256:0000000000000000000000000000", WantRelay = R, WantNode = N });
            Check("engine id differs from version.json: load (update)", v.Action == Actions.Load && v.Text.StartsWith("Updating"), v);
            v = Logic.DecideImages(new ImageFacts { Friend = true, TarPath = "x.tar", RelayId = R, NodeId = N, WantRelay = R.Substring(7), WantNode = N.Substring(7, 12) });
            Check("ok: same ids (with or without sha256:, short or long)", v.Light == Light.Green && v.Action == null, v);
            v = Logic.DecideImages(new ImageFacts { Friend = true, TarPath = null, WantRelay = R, WantNode = N });
            Check("missing and no tar: red, unzip again", v.Light == Light.Red && v.Text.Contains("missing from the package") && v.Action == null, v);
            v = Logic.DecideImages(new ImageFacts { Friend = true, TarPath = "x.tar", RelayId = R, NodeId = "sha256:1111111111111111", WantRelay = R, WantNode = N, LoadedAlready = true });
            Check("loaded but still different: amber, no second load", v.Light == Light.Amber && v.Action == null, v);
            v = Logic.DecideImages(new ImageFacts { Friend = true, TarPath = "x.tar", WantRelay = R, WantNode = N, LoadedAlready = true });
            Check("loaded and still missing: red with a load button", v.Light == Light.Red && v.Fix == Fixes.ImagesLoad, v);
            v = Logic.DecideImages(new ImageFacts { Friend = true, TarPath = "x.tar", RelayId = R, NodeId = "sha256:1111111111111111", WantRelay = R, WantNode = N, Locked = true });
            Check("different during a game: amber, loads after the game", v.Light == Light.Amber && v.Action == null, v);
            v = Logic.DecideImages(new ImageFacts { Friend = true, TarPath = "x.tar", RelayId = R, NodeId = N });
            Check("no ids in version.json: present is enough", v.Light == Light.Green, v);
            v = Logic.DecideImages(new ImageFacts { Friend = false, RelayId = R });
            Check("home, missing: red, build-images.sh, never loads", v.Light == Light.Red && v.Text.Contains("build-images.sh") && v.Action == null, v);
            v = Logic.DecideImages(new ImageFacts { Friend = false, RelayId = R, NodeId = "sha256:2222222222222222", WantRelay = R, WantNode = N });
            Check("home, not the deployed image: amber", v.Light == Light.Amber && v.Action == null, v);
            Check("SameId: short prefix of 12+", Logic.SameId("ef61822078a0", N));
            Check("SameId: under 12 hex must be equal", !Logic.SameId("ef6182", N));
            Check("SameId: different", !Logic.SameId(R, N));

            // the package's stack\deployed.json after a load (the bridge compares it exactly)
            const string RC = "sha256:aaaa69213fff7e3eccb6db806e09afbec608e7c56105020d70e3b8ac631e74b3";
            const string NC = "sha256:bbbb822078a04ba83bd1086449a2a92b3860ac3d377444a2da658e1ee781c0f6";
            const string NX = "sha256:cccc822078a04ba83bd1086449a2a92b3860ac3d377444a2da658e1ee781c0f6";
            var dep = new Dictionary<string, object> { { "bridge", "5079109f" }, { "relay", R }, { "node", N }, { "relayConfig", RC }, { "nodeConfig", NC } };
            Check("deployed: same ids (containerd store): unchanged", Logic.DeployedAfterLoad(dep, R, N) == null);
            Check("deployed: the config ids (classic store): unchanged", Logic.DeployedAfterLoad(dep, RC, NC) == null);
            var nd = Logic.DeployedAfterLoad(dep, R, NX);
            Check("deployed: another engine id: recorded as node, the package's kept", nd != null && (string)nd["node"] == NX && (string)nd["nodePackage"] == N && (string)nd["relay"] == R && !nd.ContainsKey("relayPackage") && (string)nd["bridge"] == "5079109f", nd == null ? null : J.Write(nd));
            Check("deployed: the input isn't changed", (string)dep["node"] == N);
            var nd2 = Logic.DeployedAfterLoad(nd, R, R);
            Check("deployed: a second change keeps the first package id", nd2 != null && (string)nd2["nodePackage"] == N && (string)nd2["node"] == R);
            var rd = Logic.DeployedAfterLoad(dep, NX, N);
            Check("deployed: another relay id: recorded as relay", rd != null && (string)rd["relay"] == NX && (string)rd["relayPackage"] == R && (string)rd["node"] == N);
            Check("deployed: a short id isn't exact: rewritten", Logic.DeployedAfterLoad(dep, R, N.Substring(7)) != null);
            Check("deployed: no record or no ids: nothing", Logic.DeployedAfterLoad(null, R, N) == null && Logic.DeployedAfterLoad(dep, null, N) == null && Logic.DeployedAfterLoad(dep, R, "") == null);
        }

        static ContainerInfo Up(string health) { return new ContainerInfo { Exists = true, State = "running", Health = health }; }

        static void Stack()
        {
            sb.AppendLine("-- engine stack");
            var none = Game.None("No game."); var on = Game.On("Game on", 6);
            var v = Logic.DecideStack(new ContainerInfo { Exists = false }, Up(""), null, none);
            Check("relay missing: red, Start the engine", v.Light == Light.Red && v.Fix == Fixes.StackRestart, v);
            v = Logic.DecideStack(Up("starting"), Up(""), new LoginResult { Kind = LoginKind.Skipped }, none);
            Check("relay starting: busy", v.Light == Light.Busy, v);
            v = Logic.DecideStack(Up("healthy"), Up(""), new LoginResult { Kind = LoginKind.Closed }, none);
            Check("healthy but the login drops (stale 9443 forward): red, restart relay and room", v.Light == Light.Red && v.Fix == Fixes.StackRestart && v.Text.Contains("fail at setup"), v);
            v = Logic.DecideStack(Up("healthy"), Up(""), new LoginResult { Kind = LoginKind.Ok, RoomFound = true, RoomStatus = "Lobby", Ms = 40 }, none);
            Check("login ok, room in Lobby: green", v.Light == Light.Green, v);
            v = Logic.DecideStack(Up("healthy"), Up(""), new LoginResult { Kind = LoginKind.Ok, RoomFound = true, RoomStatus = "InGame" }, none);
            Check("room InGame with no game: red (leftover room)", v.Light == Light.Red && v.Fix == Fixes.StackRestart, v);
            v = Logic.DecideStack(Up("healthy"), Up(""), new LoginResult { Kind = LoginKind.Ok, RoomFound = true, RoomStatus = "InGame" }, on);
            Check("room InGame during our game: green", v.Light == Light.Green, v);
            v = Logic.DecideStack(Up("healthy"), Up(""), new LoginResult { Kind = LoginKind.AuthFailed, Detail = "bad key" }, none);
            Check("key refused: red, no restart button", v.Light == Light.Red && v.Fix == Fixes.Retry, v);
            v = Logic.DecideStack(Up("healthy"), Up(""), new LoginResult { Kind = LoginKind.Ok, RoomFound = false }, none);
            Check("room not listed yet: busy", v.Light == Light.Busy, v);
            v = Logic.DecideStack(Up("healthy"), new ContainerInfo { Exists = true, State = "exited" }, null, none);
            Check("room container stopped: red", v.Light == Light.Red, v);
            Check("compose: port 9443 taken names the other engine", Logic.ComposeFailure("Error response from daemon: ... Bind for 127.0.0.1:9443 failed: port is already allocated").Contains("another copy of the MTG engine"));
            v = Logic.DecideStack(Up("healthy"), Up(""), new LoginResult { Kind = LoginKind.AuthFailed, Detail = "bad key" }, none, true);
            Check("friend, key refused: Stop everything, no repo stack\\.env advice", v.Text.Contains("Stop everything") && !v.Text.Contains("Check MANABREW_SERVER_KEY in stack"), v);
            string taken = "Bind for 127.0.0.1:9443 failed: port is already allocated";
            Check("friend compose: port taken says Stop everything, no Stop MTG.bat", Logic.ComposeFailure(taken, true).Contains("Stop everything") && !Logic.ComposeFailure(taken, true).Contains("Stop MTG.bat"));
            Check("home compose: port taken says Stop MTG.bat", Logic.ComposeFailure(taken).Contains("Stop MTG.bat"));
            Check("compose args: project and file", Logic.ComposeArgs(Layout.Make(Mode.Friend, @"D:\P"), "up -d") == "compose -p mtg-table -f \"D:\\P\\stack\\compose.yml\" up -d", Logic.ComposeArgs(Layout.Make(Mode.Friend, @"D:\P"), "up -d"));
        }

        static void Ports()
        {
            sb.AppendLine("-- ports");
            string ours = @"D:\MTG-Table\bridge\bridge.js";
            var v = Logic.DecidePorts(new List<Listener> { new Listener { Port = 39998, Pid = 4242, Name = "Code", CommandLine = "\"C:\\VS Code\\Code.exe\" --type=utility" } }, ours);
            Check("port held by VS Code: red, names Code.exe and the port", v != null && v.Light == Light.Red && v.Text.Contains("Code.exe") && v.Text.Contains("39998") && v.Text.Contains("4242") && v.Fix == Fixes.ShowProgram, v);
            v = Logic.DecidePorts(new List<Listener> { new Listener { Port = 39998, Pid = 7, Name = "node", CommandLine = "\"D:\\MTG-Table\\runtime\\node\\node.exe\" --report-on-fatalerror \"D:\\MTG-Table\\bridge\\bridge.js\"" } }, ours);
            Check("held by our own bridge: fine", v == null, v);
            v = Logic.DecidePorts(new List<Listener> { new Listener { Port = 48787, Pid = 8, Name = "node", CommandLine = "node --report-on-fatalerror bridge.js" } }, ours);
            Check("friend mode, held by the repo's bridge: red, another bridge", v != null && v.Light == Light.Red && v.Text.Contains("Another MTG bridge"), v);
            v = Logic.DecidePorts(new List<Listener> { new Listener { Port = 48787, Pid = 8, Name = "node", CommandLine = "node --report-on-fatalerror bridge.js" } }, null);
            Check("home mode, any bridge.js is ours", v == null, v);
            v = Logic.DecidePorts(new List<Listener> { new Listener { Port = 39998, Pid = 9, Name = "node", CommandLine = "node C:\\x\\echo-bridge.js" } }, null);
            Check("echo-bridge.js is not the bridge", v != null && v.Light == Light.Red, v);
            v = Logic.DecidePorts(new List<Listener> { new Listener { Port = 9443, Pid = 9, Name = "com.docker.backend" } }, ours);
            Check("other ports are ignored", v == null, v);
            var other = new List<Listener> { new Listener { Port = 48787, Pid = 8, Name = "node", CommandLine = "node --report-on-fatalerror bridge.js" } };
            v = Logic.DecidePorts(other, ours, true);
            Check("friend wording: another bridge, stop it in that companion", v != null && v.Text.Contains("Stop everything") && !v.Text.Contains("Stop MTG.bat"), v);
            v = Logic.DecidePorts(other, ours);
            Check("home wording: Stop MTG.bat", v != null && v.Text.Contains("Stop MTG.bat"), v);
            Check("write problem: none when all writable", Logic.WriteProblem(new[] { @"D:\P\logs", @"D:\P\bridge" }, d => null) == null);
            string wp = Logic.WriteProblem(new[] { @"D:\P\logs", @"D:\P\bridge" }, d => d.EndsWith("bridge") ? "Access to the path is denied" : null);
            Check("write problem: names the folder and the error, suggests C:\\Games\\MTG-Table", wp != null && wp.Contains(@"D:\P\bridge") && wp.Contains("denied") && wp.Contains(@"C:\Games\MTG-Table") && !wp.Contains(@"D:\P\logs"), wp);
            Check("bridge.js as a whole file name", Logic.IsBridgeCommandLine("node bridge.js") && Logic.IsBridgeCommandLine("\"node.exe\" \"C:\\a b\\bridge\\bridge.js\"") && Logic.IsBridgeCommandLine("node ./bridge/bridge.js --relay x"));
            Check("not a bridge: echo-bridge.js, bridge.json", !Logic.IsBridgeCommandLine("node echo-bridge.js") && !Logic.IsBridgeCommandLine("node bridge.json") && !Logic.IsBridgeCommandLine(null));
        }

        static void Bridge()
        {
            sb.AppendLine("-- bridge");
            var portV = new Verdict(Light.Red, "Code.exe holds 39998").WithFix(Fixes.ShowProgram, "Show the program");
            var v = Logic.DecideBridge(HttpResult.Of(HttpKind.Refused), portV, false, "e517dd99", true);
            Check("a held port wins over everything", v == portV, v);
            v = Logic.DecideBridge(HttpResult.Of(HttpKind.Refused), null, false, "e517dd99", true);
            Check("nothing answers, no process: start it", v.Action == Actions.StartBridge, v);
            v = Logic.DecideBridge(HttpResult.Of(HttpKind.Refused), null, true, "e517dd99", true);
            Check("process but refused: starting, wait", v.Action == Actions.Wait, v);
            v = Logic.DecideBridge(HttpResult.Ok("{\"now\":{\"bridge\":\"e517dd99\"}}"), null, true, "e517dd99", true);
            Check("/versions answers with the package's bridge: green", v.Light == Light.Green && v.Text.Contains("e517dd99"), v);
            v = Logic.DecideBridge(HttpResult.Ok("{\"now\":{\"bridge\":\"aaaaaaaa\"}}"), null, true, "e517dd99", true);
            Check("another bridge version: amber with a restart button", v.Light == Light.Amber && v.Fix == Fixes.BridgeRestart, v);
            v = Logic.DecideBridge(HttpResult.Of(HttpKind.Timeout), null, true, null, true);
            Check("slow is not down: a timeout is amber, never a start", v.Light == Light.Amber && v.Action == null, v);
            Check("exit lines counted", Logic.CountExits("x\n[bridge exited with code 1 at 1; restarting in 3 s]\n[bridge exited with code 1 at 2; restarting in 3 s]\n") == 2);
        }

        static HttpResult State(string body) { return HttpResult.Ok(body); }

        static void GameLock()
        {
            sb.AppendLine("-- game lock");
            var g = Logic.DecideGame(State("{\"started\":true,\"seats\":[{\"turn\":6},{\"turn\":6}]}"), null);
            Check("/state started:true: game on, turn 6", g.Kind == GameKind.On && g.Turn == 6 && Logic.Locked(g), g.Text);
            g = Logic.DecideGame(State("{\"started\":false,\"seats\":[{\"color\":\"White\"}]}"), null);
            Check("seated but not started (setup or just over): locked", g.Kind == GameKind.On && Logic.Locked(g), g.Text);
            g = Logic.DecideGame(State("{\"started\":false,\"seats\":null}"), null);
            Check("seats null: no game, unlocked", g.Kind == GameKind.None && !Logic.Locked(g), g.Text);
            g = Logic.DecideGame(State("{\"started\":false,\"seats\":null}"), 12);
            Check("seats null but a resume file 12 s old: locked (bridge just restarted)", Logic.Locked(g), g.Text);
            g = Logic.DecideGame(HttpResult.Of(HttpKind.Refused), null);
            Check("no bridge, no resume file: no game", g.Kind == GameKind.None, g.Text);
            g = Logic.DecideGame(HttpResult.Of(HttpKind.Refused), 20);
            Check("no bridge, resume file 20 s old (crashed mid-game): game on", g.Kind == GameKind.On, g.Text);
            g = Logic.DecideGame(HttpResult.Of(HttpKind.Refused), 600);
            Check("no bridge, stale resume file (10 min): no game", g.Kind == GameKind.None, g.Text);
            g = Logic.DecideGame(HttpResult.Of(HttpKind.Timeout), null);
            Check("bridge times out: can't tell, locked", g.Kind == GameKind.CantTell && Logic.Locked(g), g.Text);
            g = Logic.DecideGame(State("not json"), null);
            Check("unreadable answer: can't tell", g.Kind == GameKind.CantTell, g.Text);
            g = Logic.DecideGame(new HttpResult { Kind = HttpKind.Ok, Status = 500, Body = "" }, null);
            Check("HTTP 500: can't tell", g.Kind == GameKind.CantTell, g.Text);
            Check("locked fixes: restart relay/room, bridge, image load", Fixes.LocksDuringGame(Fixes.StackRestart) && Fixes.LocksDuringGame(Fixes.BridgeRestart) && Fixes.LocksDuringGame(Fixes.ImagesLoad));
            Check("never locked: open TTS, start Docker, start a dead bridge, try again", !Fixes.LocksDuringGame(Fixes.TtsOpen) && !Fixes.LocksDuringGame(Fixes.DockerStart) && !Fixes.LocksDuringGame(Fixes.BridgeStart) && !Fixes.LocksDuringGame(Fixes.Retry));

            // the real Controller refuses while a game is on (its worker isn't started: nothing can run)
            var tmp = Path.Combine(Path.GetTempPath(), "mtg-companion-selftest-" + Guid.NewGuid().ToString("N").Substring(0, 6));
            var c = new Controller(Layout.Make(Mode.Friend, tmp), false, Path.Combine(tmp, "saves"), Path.Combine(tmp, "state"), "x.exe");
            c.Game = Game.On("Game on: turn 6, 4 seats.", 6);
            var r1 = c.RestartEngine();
            var r2 = c.DoFix(Controller.StepStack, Fixes.StackRestart);
            var r3 = c.DoFix(Controller.StepBridge, Fixes.BridgeRestart);
            var r4 = c.DoFix(Controller.StepImages, Fixes.ImagesLoad);
            Check("game on: Restart engine refused", r1 != null && r1.Contains("game is on"), r1);
            Check("game on: Restart relay and room refused", r2 != null, r2);
            Check("game on: Restart the bridge refused", r3 != null, r3);
            Check("game on: Load the engine images refused", r4 != null, r4);
            c.Game = Game.CantTell("bridge slow");
            var r5 = c.RestartEngine();
            Check("can't tell: Restart engine refused too", r5 != null && r5.Contains("can't tell"), r5);
            var o = new Controller(Layout.Make(Mode.Friend, tmp), true, tmp, tmp, "x.exe");
            o.Game = Game.None("No game.");
            Check("observe mode: every change refused", o.RestartEngine() != null && o.DoFix(Controller.StepTts, Fixes.TtsOpen) != null);
        }

        static List<SaveEntry> E(params string[] names) { return names.Select(n => new SaveEntry(n, n.EndsWith(".json") ? 1000 : 50)).ToList(); }

        static void Saves()
        {
            sb.AppendLine("-- table save install");
            Func<string, string> noHash = n => "other";
            var p = Logic.PlanSave(E("TS_Save_1.json", "TS_Save_1.png", "TS_AutoSave.json", "SaveFileInfos.json"), null, "aaaa1111", "aaaa1111", 2000, noHash);
            Check("first run: a new number (TS_Save_2.json)", p.Kind == SaveKind.Install && p.File == "TS_Save_2.json", p);
            p = Logic.PlanSave(E("TS_Save_3.png", "TS_Save_1.json"), null, "aaaa1111", "aaaa1111", 2000, noHash);
            Check("a number used only by a .png is taken too (TS_Save_4.json)", p.Kind == SaveKind.Install && p.File == "TS_Save_4.json", p);
            p = Logic.PlanSave(E(), null, "aaaa1111", "aaaa1111", 2000, noHash);
            Check("empty Saves folder: TS_Save_1.json", p.Kind == SaveKind.Install && p.File == "TS_Save_1.json", p);
            var st = new InstallState { SaveFile = "TS_Save_2.json", SaveHash = "aaaa1111" };
            p = Logic.PlanSave(E("TS_Save_1.json", "TS_Save_2.json"), st, "aaaa1111", "aaaa1111", 2000, noHash);
            Check("ours, same hash: leave it (even if the player saved over it)", p.Kind == SaveKind.Skip && p.File == "TS_Save_2.json", p);
            Func<string, string> asInstalled = n => n == "TS_Save_2.json" ? "aaaa1111" : "other";
            p = Logic.PlanSave(E("TS_Save_1.json", "TS_Save_2.json"), st, "bbbb2222", "bbbb2222", 2000, asInstalled);
            Check("ours, untouched, package hash changed: update that same file", p.Kind == SaveKind.Update && p.File == "TS_Save_2.json", p);
            p = Logic.PlanSave(E("TS_Save_1.json", "TS_Save_2.json"), st, "bbbb2222", "bbbb2222", 2000, noHash);
            Check("ours but the player saved over it, package changed: a new number, never that file", p.Kind == SaveKind.Install && p.File == "TS_Save_3.json", p);
            p = Logic.PlanSave(E("TS_Save_1.json"), st, "bbbb2222", "bbbb2222", 2000, noHash);
            Check("ours but deleted: install again under the same free name", p.Kind == SaveKind.Install && p.File == "TS_Save_2.json", p);
            var ex = new List<SaveEntry> { new SaveEntry("TS_Save_1.json", 999), new SaveEntry("TS_Save_5.json", 2000) };
            p = Logic.PlanSave(ex, null, "aaaa1111", "aaaa1111", 2000, n => n == "TS_Save_5.json" ? "aaaa1111" : "zzzz");
            Check("no record, an identical file exists: adopt it, no write", p.Kind == SaveKind.Adopt && p.File == "TS_Save_5.json", p);
            p = Logic.PlanSave(ex, null, "aaaa1111", "aaaa1111", 2000, n => "zzzz");
            Check("same size, other content: a new number, never that file", p.Kind == SaveKind.Install && p.File == "TS_Save_6.json", p);
            p = Logic.PlanSave(E("TS_Save_1.json", "Mock.json"), new InstallState { SaveFile = "Mock.json", SaveHash = "x" }, "aaaa1111", "aaaa1111", 2000, noHash);
            Check("a record naming a non-TS_Save file is ignored (never updated)", p.Kind == SaveKind.Install && p.File == "TS_Save_2.json", p);
            p = Logic.PlanSave(E("TS_Save_1.json"), new InstallState { SaveFile = @"..\TS_Save_1.json", SaveHash = "x" }, "aaaa1111", "aaaa1111", 2000, noHash);
            Check("a record with a path in it is ignored", p.Kind == SaveKind.Install && p.File == "TS_Save_2.json", p);

            // every Install lands on a free name and every Update on the recorded file: 500 random folders
            var rnd = new Random(7);
            bool allSafe = true; string bad = null;
            for (int i = 0; i < 500; i++)
            {
                var names = new List<string>();
                for (int k = 0; k < rnd.Next(0, 8); k++) names.Add("TS_Save_" + rnd.Next(1, 12) + (rnd.Next(2) == 0 ? ".json" : ".png"));
                if (rnd.Next(3) == 0) names.Add("TS_AutoSave.json");
                names = names.Distinct().ToList();
                InstallState s = null;
                if (rnd.Next(2) == 0) s = new InstallState { SaveFile = "TS_Save_" + rnd.Next(1, 12) + ".json", SaveHash = rnd.Next(2) == 0 ? "h1" : "h2" };
                var plan = Logic.PlanSave(E(names.ToArray()), s, "h1", "h1", 1000, n => rnd.Next(4) == 0 ? "h1" : "h0");
                bool exists = names.Contains(plan.File);
                bool ok = plan.Kind == SaveKind.Install ? !exists
                    : plan.Kind == SaveKind.Update ? (s != null && plan.File == s.SaveFile && exists)
                    : exists;
                if (!ok) { allSafe = false; bad = string.Join(",", names) + " -> " + plan; break; }
            }
            Check("500 random Saves folders: never writes over a file it didn't install", allSafe, bad);
            Check("SaveName read from the save", Logic.ReadSaveName("{\n  \"SaveName\": \"MTG Table (rules engine)\",\n  \"EpochTime\": 1}") == "MTG Table (rules engine)");
            Check("SaveName with an escaped quote", Logic.ReadSaveName("{\"SaveName\": \"A \\\"B\\\"\"}") == "A \"B\"");
            Check("sha8 like the bridge's", Logic.Sha8(Encoding.UTF8.GetBytes("abc")) == "ba7816bf");
        }

        static void Tts()
        {
            sb.AppendLine("-- TTS");
            var v = Logic.DecideTts(new TtsFacts { Running = false, SteamFound = true, SaveName = "MTG Table (rules engine)" });
            Check("not running: amber, Open TTS", v.Light == Light.Amber && v.Fix == Fixes.TtsOpen, v);
            v = Logic.DecideTts(new TtsFacts { Running = true, VersionsOk = true, TableHeard = false, SaveName = "MTG Table (rules engine)" });
            Check("running, no table yet: the menu path", v.Light == Light.Amber && v.Text.Contains("Create → Singleplayer (or Multiplayer) → Games → Save & Load → MTG Table (rules engine)"), v);
            v = Logic.DecideTts(new TtsFacts { Running = true, VersionsOk = true, TableHeard = true, Table = "11111111", WantTable = "0fa50b21", SaveName = "MTG Table (rules engine)" });
            Check("old table loaded: red, load it again", v.Light == Light.Red && v.Text.StartsWith("Old table loaded") && v.Text.Contains("load MTG Table (rules engine) again"), v);
            v = Logic.DecideTts(new TtsFacts { Running = true, VersionsOk = true, TableHeard = true, Table = null, WantTable = "0fa50b21" });
            Check("a table older than stamps: red", v.Light == Light.Red, v);
            v = Logic.DecideTts(new TtsFacts { Running = true, VersionsOk = true, TableHeard = true, Table = "0fa50b21", WantTable = "0fa50b21" });
            Check("the package's table: green", v.Light == Light.Green && v.Text.Contains("0fa50b21"), v);
            v = Logic.DecideTts(new TtsFacts { Running = true, VersionsOk = false });
            Check("bridge down: amber, can't check the table", v.Light == Light.Amber, v);
            var now = J.Get(J.Parse("{\"now\":{\"bridge\":\"x\",\"node\":null}}"), "now");
            Check("/versions without now.table: no table heard", !J.Has(now, "table"));
            now = J.Get(J.Parse("{\"now\":{\"bridge\":\"x\",\"table\":null}}"), "now");
            Check("/versions now.table null: heard, no stamp", J.Has(now, "table") && J.Str(now, "table") == null);
        }

        static void Wsl()
        {
            sb.AppendLine("-- .wslconfig (optional button)");
            Check("no file: a [wsl2] section", Logic.SetWslLimits(null, 2, "8GB") == "[wsl2]\r\nprocessors=2\r\nmemory=8GB\r\n", Logic.SetWslLimits(null, 2, "8GB"));
            string t = "[wsl2]\nprocessors=3\nswap=0\n";
            Check("existing: processors replaced, memory added, other lines kept, LF kept", Logic.SetWslLimits(t, 2, "8GB") == "[wsl2]\nmemory=8GB\nprocessors=2\nswap=0\n", Logic.SetWslLimits(t, 2, "8GB"));
            t = "[interop]\r\nenabled=false\r\n";
            Check("another section only: [wsl2] appended", Logic.SetWslLimits(t, 2, "8GB") == "[interop]\r\nenabled=false\r\n\r\n[wsl2]\r\nprocessors=2\r\nmemory=8GB\r\n", Logic.SetWslLimits(t, 2, "8GB"));
            t = "[wsl2]\r\nmemory=4GB\r\n[experimental]\r\nprocessors=9\r\n";
            Check("only the [wsl2] section is edited", Logic.SetWslLimits(t, 2, "8GB") == "[wsl2]\r\nprocessors=2\r\nmemory=8GB\r\n[experimental]\r\nprocessors=9\r\n", Logic.SetWslLimits(t, 2, "8GB"));
        }

        static string Part(string file, string version, string release = null, long size = 100)
        {
            return "{\"file\":\"" + file + "\",\"sha256\":\"" + new string('a', 64) + "\",\"size\":" + size + ",\"version\":\"" + version + "\"" + (release != null ? ",\"release\":\"" + release + "\"" : "") + "}";
        }

        static string Manifest(string parts, int min = 1, string version = "v2026.11.10-1200")
        {
            return "{\"format\":1,\"version\":\"" + version + "\",\"built\":\"2026-11-10T12:00:00Z\",\"minCompanion\":" + min + ",\"parts\":{" + parts + "},\"versionJson\":{\"bridge\":\"b2\"},\"deployedJson\":{\"bridge\":\"b2\"}}";
        }

        static void Update()
        {
            sb.AppendLine("-- self-update");
            string err;
            var m = Updates.ParseManifest(Manifest("\"app\":" + Part("app.zip", "a2") + ",\"images\":" + Part("images.tar", "i1", "v2026.11.01-0900") + ",\"table\":" + Part("table.zip", "s1")), out err);
            Check("manifest: parsed, parts and their releases", m != null && m.Parts.Count == 3 && m.Parts["images"].Release == "v2026.11.01-0900" && m.Parts["app"].Release == "v2026.11.10-1200" && m.Parts["app"].Size == 100, err);
            Check("manifest: a file name with a path is refused", Updates.ParseManifest(Manifest("\"app\":" + Part("..\\\\x.zip", "a")), out err) == null && err.Contains("file name"), err);
            Check("manifest: a file name of dots is refused", Updates.ParseManifest(Manifest("\"app\":" + Part("..", "a")), out err) == null, err);
            Check("manifest: no sha256 refused", Updates.ParseManifest(Manifest("\"app\":{\"file\":\"app.zip\",\"size\":5,\"version\":\"a\"}"), out err) == null && err.Contains("sha256"), err);
            Check("manifest: size 0 refused", Updates.ParseManifest(Manifest("\"app\":" + Part("app.zip", "a", null, 0)), out err) == null && err.Contains("size"), err);
            Check("manifest: a tag with a slash refused", Updates.ParseManifest(Manifest("\"app\":" + Part("app.zip", "a"), 1, "v1/../x"), out err) == null, err);
            Check("manifest: not JSON", Updates.ParseManifest("<html>", out err) == null, err);
            Check("manifest: an unknown part is skipped", Updates.ParseManifest(Manifest("\"app\":" + Part("app.zip", "a") + ",\"maps\":" + Part("maps.zip", "m")), out err).Parts.Count == 1, err);

            const string RID = "sha256:dbfe69213fff7e3eccb6db806e09afbec608e7c56105020d70e3b8ac631e74b3", NID = "sha256:ef61822078a04ba83bd1086449a2a92b3860ac3d377444a2da658e1ee781c0f6";
            var old = J.Parse("{\"save\":\"s1\",\"node\":\"" + NID + "\",\"relay\":\"" + RID + "\",\"nodeVersion\":\"v24.1.0\"}");
            Check("local: an old package's table, images and runtime versions", Updates.LocalVersion(old, "table") == "s1" && Updates.LocalVersion(old, "images") == Updates.ImagesVersion(NID, RID) && Updates.LocalVersion(old, "runtime") == "v24.1.0");
            Check("local: app and companion unknown", Updates.LocalVersion(old, "app") == null && Updates.LocalVersion(old, "companion") == null);
            Check("local: parts win", Updates.LocalVersion(J.Parse("{\"save\":\"s1\",\"parts\":{\"table\":\"s9\"}}"), "table") == "s9");
            Check("images version: sha8 of node + relay (the packager's)", Updates.ImagesVersion("n", "r") == Logic.Sha8(Encoding.UTF8.GetBytes("nr")) && Updates.ImagesVersion("n", "r") != Updates.ImagesVersion("r", "n"));

            var local = J.Parse("{\"built\":\"2026-11-10T12:00:00.000Z\",\"parts\":{\"app\":\"a1\",\"table\":\"s1\",\"images\":\"i1\",\"companion\":\"c1\"}}");
            var all = Manifest("\"app\":" + Part("app.zip", "a1") + ",\"table\":" + Part("table.zip", "s1") + ",\"images\":" + Part("images.tar", "i1") + ",\"companion\":" + Part("MTG.Companion.exe", "c1"));
            var p = Updates.Plan(local, Updates.ParseManifest(all, out err), 1);
            Check("plan: same versions: up to date", p.UpToDate && p.Fetch.Count == 0 && p.Refused == null, p.Fetch.Count);
            p = Updates.Plan(local, Updates.ParseManifest(all.Replace("\"a1\"", "\"a2\""), out err), 1);
            Check("plan: new app only", !p.UpToDate && p.Fetch.Count == 1 && p.Has("app") && p.Bytes == 100, string.Join(",", p.Fetch.Select(x => x.Name)));
            p = Updates.Plan(local, Updates.ParseManifest(all.Replace("\"i1\"", "\"i2\""), out err), 1);
            Check("plan: new images only: the tar alone", p.Fetch.Count == 1 && p.Has("images"), string.Join(",", p.Fetch.Select(x => x.Name)));
            p = Updates.Plan(local, Updates.ParseManifest(all.Replace("\"a1\"", "\"a2\"").Replace("\"c1\"", "\"c2\""), out err), 1);
            Check("plan: the companion is applied last", p.Fetch.Count == 2 && p.Fetch.Last().Name == "companion" && !p.CompanionFirst, string.Join(",", p.Fetch.Select(x => x.Name)));
            p = Updates.Plan(local, Updates.ParseManifest(Manifest("\"app\":" + Part("app.zip", "a2") + ",\"companion\":" + Part("MTG.Companion.exe", "c2"), 2), out err), 1);
            Check("plan: needs a newer app: the companion first", p.CompanionFirst && p.Refused == null && !p.UpToDate, p.Refused);
            p = Updates.Plan(local, Updates.ParseManifest(Manifest("\"app\":" + Part("app.zip", "a2"), 2), out err), 1);
            Check("plan: needs a newer app it doesn't carry: refused", p.Refused != null && p.Refused.Contains("full package"), p.Refused);
            p = Updates.Plan(J.Parse("{\"built\":\"2026-11-01T09:00:00.000Z\"}"), Updates.ParseManifest(all, out err), 1);
            Check("plan: an old package without parts takes app and companion", p.Has("app") && p.Has("companion") && p.Has("table") && p.Has("images"), string.Join(",", p.Fetch.Select(x => x.Name)));

            // downgrades: a release built before this package is refused (and not offered); the same build is no downgrade
            Func<string, string> builtAt = t => all.Replace("\"a1\"", "\"a2\"").Replace("\"built\":\"2026-11-10T12:00:00Z\"", t == null ? "\"built0\":\"\"" : "\"built\":\"" + t + "\"");
            p = Updates.Plan(local, Updates.ParseManifest(builtAt("2026-11-09T12:00:00Z"), out err), 1);
            Check("downgrade: an older release is refused, says so", p.Refused != null && p.Refused.Contains("older than this package; not installing it") && !p.UpToDate, p.Refused);
            p = Updates.Plan(local, Updates.ParseManifest(builtAt("2026-11-10T11:59:59.999Z"), out err), 1);
            Check("downgrade: a millisecond older is refused", p.Refused != null && p.Refused.Contains("older"), p.Refused);
            p = Updates.Plan(local, Updates.ParseManifest(builtAt("2026-11-10T13:00:00+01:00"), out err), 1);
            Check("downgrade: the same time in another zone and format is the same build: the parts decide (new app offered)", p.Refused == null && p.Has("app"), p.Refused);
            p = Updates.Plan(local, Updates.ParseManifest(all.Replace("\"built\":\"2026-11-10T12:00:00Z\"", "\"built\":\"2026-11-10T12:00:00.000Z\""), out err), 1);
            Check("downgrade: the same build, the same parts: up to date", p.UpToDate && p.Refused == null, p.Refused);
            p = Updates.Plan(local, Updates.ParseManifest(builtAt("2026-11-11T00:00:00Z"), out err), 1);
            Check("downgrade: a newer release is offered", p.Refused == null && !p.UpToDate && p.Has("app"), p.Refused);
            p = Updates.Plan(local, Updates.ParseManifest(builtAt(null), out err), 1);
            Check("downgrade: a manifest with no build time is refused", p.Refused != null && p.Refused.Contains("no usable build time"), p.Refused);
            foreach (var bad in new[] { "{\"parts\":{\"app\":\"a1\"}}", "{\"built\":\"garbage\"}", "{\"built\":\"11/10/2026\"}", "{\"built\":\"2026-11-10T12:00:00\"}" })
            {
                p = Updates.Plan(J.Parse(bad), Updates.ParseManifest(builtAt("2026-11-11T00:00:00Z"), out err), 1);
                Check("downgrade: no usable local build time (" + bad + ") is refused (fail safe)", p.Refused != null && p.Refused.Contains("no build time"), p.Refused);
            }
            p = Updates.Plan(local, Updates.ParseManifest(Manifest("\"app\":" + Part("app.zip", "a2") + ",\"companion\":" + Part("MTG.Companion.exe", "c2"), 2).Replace("2026-11-10T12:00:00Z", "2026-11-01T00:00:00Z"), out err), 1);
            Check("downgrade: an older release that would swap the companion first is refused, no swap", p.Refused != null && !p.CompanionFirst, p.Refused);
            var olderM = Updates.ParseManifest(builtAt("2026-11-01T00:00:00Z"), out err);
            var olderR = new CheckResult { Manifest = olderM, Plan = Updates.Plan(local, olderM, 1), Text = Updates.Plan(local, olderM, 1).Refused };
            var ous = new UpdateState();
            ous.Checked(olderR, false, DateTime.UtcNow);
            var osec = J.Parse(J.Write(WebUi.UpdateSection(ous, true, false))); // (as the page gets it)
            Check("downgrade: not offered (no Update now on the page, the line says why)", !olderR.Available && ous.Available == null && J.Arr(osec, "actions") != null && J.Arr(osec, "actions").Any(a => J.Str(a, "id") == "update-check") && !J.Arr(osec, "actions").Any(a => J.Str(a, "id") == "update-now") && J.Str(osec, "line").Contains("older than this package"), J.Write(osec));

            bool api;
            Check("url: the API over https, the token's host", Updates.AllowedUrl("https://api.github.com/repos/x/y/releases/latest", null, out api) && api);
            Check("url: the asset hosts, no token", Updates.AllowedUrl("https://objects.githubusercontent.com/a?b=c", null, out api) && !api
                && Updates.AllowedUrl("https://release-assets.githubusercontent.com/x", null, out api) && !api && Updates.AllowedUrl("https://github.com/o/r/releases/download/t/f", null, out api) && !api);
            Check("url: http refused", !Updates.AllowedUrl("http://api.github.com/x", null, out api));
            Check("url: another host refused", !Updates.AllowedUrl("https://example.com/app.zip", null, out api) && !Updates.AllowedUrl("https://api.github.com.evil.com/x", null, out api) && !Updates.AllowedUrl("https://evilgithub.com/x", null, out api));
            Check("url: user info refused (https://api.github.com@evil)", !Updates.AllowedUrl("https://api.github.com@evil.com/x", null, out api) && !Updates.AllowedUrl("https://user@api.github.com/x", null, out api));
            Check("url: another port refused", !Updates.AllowedUrl("https://api.github.com:8443/x", null, out api));
            Check("url: garbage refused", !Updates.AllowedUrl("not a url", null, out api) && !Updates.AllowedUrl(null, null, out api) && !Updates.AllowedUrl("file:///C:/x", null, out api));
            Check("url, test base: the fake is the API, localhost on its port the asset host", Updates.AllowedUrl("http://127.0.0.1:5000/repos", "http://127.0.0.1:5000", out api) && api
                && Updates.AllowedUrl("http://localhost:5000/dl/x", "http://127.0.0.1:5000", out api) && !api);
            Check("url, test base: GitHub itself and other ports refused", !Updates.AllowedUrl("https://api.github.com/x", "http://127.0.0.1:5000", out api) && !Updates.AllowedUrl("http://127.0.0.1:5001/x", "http://127.0.0.1:5000", out api) && !Updates.AllowedUrl("http://localhost:5001/x", "http://127.0.0.1:5000", out api));

            var rel = Updates.ParseRelease("{\"tag_name\":\"v1\",\"assets\":[{\"name\":\"update-manifest.json\",\"url\":\"https://api.github.com/repos/o/r/releases/assets/7\",\"size\":900}]}");
            Check("release: tag and assets", rel != null && rel.Tag == "v1" && rel.Assets.Count == 1 && rel.Assets[0].Size == 900 && rel.Assets[0].Url.EndsWith("/assets/7"));
            Check("release: no tag", Updates.ParseRelease("{\"message\":\"Not Found\"}") == null && Updates.ParseRelease("nope") == null);
            Check("check: 404 is the quiet line", Updates.CheckFailed(404, null) == Updates.NotPublic);
            Check("check: 403 names the token or the rate limit", Updates.CheckFailed(403, null).Contains("token") && Updates.CheckFailed(0, "timed out").Contains("timed out"));
            var now = new DateTime(2026, 11, 10, 12, 0, 0, DateTimeKind.Utc);
            Check("check due: never checked", Updates.CheckDue(null, now) && Updates.CheckDue("garbage", now));
            Check("check due: 5 h ago no, 6 h ago yes", !Updates.CheckDue(now.AddHours(-5).ToString("o"), now) && Updates.CheckDue(now.AddHours(-6).ToString("o"), now));
            Check("check due: a time in the future (clock set back) yes", Updates.CheckDue(now.AddHours(2).ToString("o"), now));
            var bk = new[] { new KeyValuePair<string, DateTime>("a", now.AddDays(-3)), new KeyValuePair<string, DateTime>("b", now.AddDays(-1)), new KeyValuePair<string, DateTime>("c", now.AddDays(-2)) };
            var prune = Updates.BackupsToPrune(bk, 2);
            Check("backups: the last 2 kept", prune.Count == 1 && prune[0] == "a", string.Join(",", prune));
            Check("backups: 2 or fewer: none pruned", Updates.BackupsToPrune(bk.Take(2), 2).Count == 0);
            var live = new[] { new KeyValuePair<string, DateTime>(@"C:\pkg\backup\v1", now.AddDays(-9)), new KeyValuePair<string, DateTime>(@"C:\pkg\backup\v2", now.AddDays(-2)), new KeyValuePair<string, DateTime>(@"C:\pkg\backup\v3", now.AddDays(-1)) };
            prune = Updates.BackupsToPrune(live, 2, @"c:\PKG\backup\v1\");
            Check("backups: never the one a journal points at (the oldest, case and a trailing slash aside)", prune.Count == 0, string.Join(",", prune));
            prune = Updates.BackupsToPrune(live, 1, @"C:\pkg\backup\v1");
            Check("backups: never the journal's, for the images either", prune.Count == 1 && prune[0] == @"C:\pkg\backup\v2", string.Join(",", prune));
            Check("backups: no journal: the oldest goes", Updates.BackupsToPrune(live, 2, null).SequenceEqual(new[] { @"C:\pkg\backup\v1" }));
            Check("backup name: the release, else the build date, plain", Updates.BackupName(J.Parse("{\"release\":\"v2026.11.09-1432\"}")) == "v2026.11.09-1432" && Updates.BackupName(J.Parse("{\"built\":\"2026-11-09T14:32:00.000Z\"}")) == "built-2026-11-09T14-32-00.000Z", Updates.BackupName(J.Parse("{\"built\":\"2026-11-09T14:32:00.000Z\"}")));
            Check("zip entry: inside the part", Updates.EntryPath("app", "bridge/bridge.js") == "bridge/bridge.js" && Updates.EntryPath("app", "stack/compose.yml") == "stack/compose.yml" && Updates.EntryPath("table", "table\\MTG Table.json") == "table/MTG Table.json");
            Check("zip entry: outside the part refused", Updates.EntryPath("app", "MTG Companion.exe") == null && Updates.EntryPath("app", "stack/.env") == null && Updates.EntryPath("table", "bridge/bridge.js") == null && Updates.EntryPath("app", "bridgex/a.js") == null);
            Check("zip entry: climbing out refused", Updates.EntryPath("app", "bridge/../../evil.js") == null && Updates.EntryPath("app", "/bridge/a.js") == null && Updates.EntryPath("app", "C:/bridge/a.js") == null && Updates.EntryPath("app", "bridge/./a.js") == null);
            Check("zip entry: a part with no files of its own (companion) refused", Updates.EntryPath("companion", "MTG Companion.exe") == null);

            // the state snapshot the window and the status page read
            var man = Updates.ParseManifest(all.Replace("\"a1\"", "\"a2\""), out err);
            var avail = new CheckResult { Manifest = man, Plan = Updates.Plan(local, man, 1), Text = "Update available: v2026.11.10-1200 (…)." };
            var us = new UpdateState { Status = "checking", Progress = 40 };
            us.Checked(avail, false, now);
            Check("state: available, with the version and notes", us.Status == "available" && us.Available == "v2026.11.10-1200" && us.Notes == avail.Text && !us.Later && us.Error == null && us.Progress == -1 && us.LastCheck == now.ToString("o"), us.Status);
            us.Checked(avail, true, now);
            Check("state: Later stays for the same release", us.Later);
            us.Checked(new CheckResult { Failed = true, Quiet = true, Text = Updates.NotPublic }, true, now);
            Check("state: 404 is not-public, no error, nothing offered", us.Status == "not-public" && us.Error == null && us.Available == null && !us.Later, us.Status);
            us.Checked(new CheckResult { Failed = true, Text = "Couldn't check for updates (HTTP 500)." }, false, now);
            Check("state: a failed check is failed, with the error", us.Status == "failed" && us.Error.Contains("HTTP 500"), us.Status);
            var upToDate = Updates.ParseManifest(all, out err);
            us.Checked(new CheckResult { Manifest = upToDate, Plan = Updates.Plan(local, upToDate, 1), Text = "Up to date." }, false, now);
            Check("state: up to date", us.Status == "up-to-date" && us.Available == null && us.Error == null, us.Status);
            var refusedM = Updates.ParseManifest(Manifest("\"app\":" + Part("app.zip", "a2"), 2), out err);
            us.Checked(new CheckResult { Manifest = refusedM, Plan = Updates.Plan(local, refusedM, 1), Text = "needs a newer" }, false, now);
            Check("state: a release this app can't apply is failed, not available", us.Status == "failed" && us.Available == null, us.Status);
            us.Checked(avail, false, now);
            us.Applied(new ApplyResult { Deferred = true, Text = "Update ready — will install after this game." });
            Check("state: deferred until the game ends, still offered", us.Status == "ready" && us.DeferredUntilGameEnds && us.Available != null && us.Error == null, us.Status);
            us.Applied(new ApplyResult { Text = "The update failed and was undone: x." });
            Check("state: failed install, the error kept, still offered", us.Status == "failed" && us.Error.Contains("undone") && !us.DeferredUntilGameEnds && us.Available != null, us.Status);
            us.Applied(new ApplyResult { Ok = true, Swapping = true, Text = "takes over" });
            Check("state: restarting while the new app takes over", us.Status == "restarting" && us.Error == null, us.Status);
            us.Applied(new ApplyResult { Ok = true, Text = "Updated to v2." });
            Check("state: updated, nothing offered", us.Status == "updated" && us.Available == null && us.Notes == null && us.Error == null, us.Status);
            // what Update now installs (Controller.offer): never a stale offer
            Check("offer: a check that offers a release keeps it", Updates.OfferAfterCheck(avail) == avail);
            Check("offer: a check that offers nothing (up to date, refused, failed, 404) clears it",
                Updates.OfferAfterCheck(new CheckResult { Manifest = upToDate, Plan = Updates.Plan(local, upToDate, 1) }) == null && Updates.OfferAfterCheck(olderR) == null
                && Updates.OfferAfterCheck(new CheckResult { Failed = true, Text = "x" }) == null && Updates.OfferAfterCheck(null) == null);
            Check("offer: an install clears it (whichever release it was), a swap too", Updates.OfferAfterApply(avail, new ApplyResult { Ok = true, Text = "Updated to v2." }) == null && Updates.OfferAfterApply(avail, new ApplyResult { Ok = true, Swapping = true }) == null);
            Check("offer: a failed or deferred install keeps it (Update now again)", Updates.OfferAfterApply(avail, new ApplyResult { Text = "failed" }) == avail && Updates.OfferAfterApply(avail, new ApplyResult { Deferred = true }) == avail);
            var cp = us.Copy(); cp.Status = "x";
            Check("state: a snapshot is a copy", us.Status == "updated");
        }

        // the file ops of the exe swap, in memory, with failures on demand
        class FakeOps : IFileOps
        {
            public HashSet<string> Files = new HashSet<string>();
            public int FailAside, Slept; public bool FailTakeName;
            public void Move(string from, string to)
            {
                if (from.EndsWith("MTG Companion.exe") && to.EndsWith(Updater.OldExe) && FailAside-- > 0) throw new IOException("in use");
                if (to.EndsWith("MTG Companion.exe") && from.EndsWith(Updater.NewExe) && FailTakeName) throw new IOException("denied");
                if (!Files.Remove(from) || Files.Contains(to)) throw new IOException("no " + from);
                Files.Add(to);
            }
            public void Delete(string path) { Files.Remove(path); }
            public bool Exists(string path) { return Files.Contains(path); }
            public void Sleep(int ms) { Slept++; }
        }

        static void UpdateSafety()
        {
            sb.AppendLine("-- self-update: safety");
            // zip entries Windows would resolve elsewhere: trailing dots and spaces, alternate data streams
            Check("zip entry: '.. ' (trailing space) refused", Updates.EntryPath("app", "bridge/.. /x") == null);
            Check("zip entry: '...' refused", Updates.EntryPath("app", "bridge/.../x") == null);
            Check("zip entry: '... ' refused", Updates.EntryPath("app", "bridge/... /x") == null);
            Check("zip entry: a name ending in a dot or a space refused", Updates.EntryPath("app", "bridge/a.js.") == null && Updates.EntryPath("app", "bridge/a.js ") == null && Updates.EntryPath("app", "bridge. /a.js") == null);
            Check("zip entry: an alternate data stream refused", Updates.EntryPath("app", "bridge/a.js:evil") == null && Updates.EntryPath("app", "bridge/a.js::$DATA") == null);
            Check("zip entry: ordinary dotted names kept", Updates.EntryPath("app", "bridge/.hidden/a.b.js") == "bridge/.hidden/a.b.js", Updates.EntryPath("app", "bridge/.hidden/a.b.js"));
            Check("contained: inside the hold", Updates.Contained(@"C:\pkg", "bridge/a.js", "app") && Updates.Contained(@"C:\pkg", "stack/compose.yml", "app"));
            Check("contained: a sibling folder with the hold's name as prefix refused", !Updates.Contained(@"C:\pkg", "bridgex/a.js", "app") && !Updates.Contained(@"C:\pkg", "stack/.env", "app"));
            Check("contained: climbing out refused", !Updates.Contained(@"C:\pkg", "bridge/../../x", "app") && !Updates.Contained(@"C:\pkg", "bridge/../MTG Companion.exe", "app"));
            Check("contained: '.. ' and '...' resolve outside: refused on their own too", !Updates.Contained(@"C:\pkg", "bridge/.. /x", "app") && !Updates.Contained(@"C:\pkg", "bridge/.. /.. /x", "app"));
            Check("token: only to the API, never to a test server", Updates.TokenFor(true, null, "t") == "t" && Updates.TokenFor(false, null, "t") == null && Updates.TokenFor(true, "http://127.0.0.1:5000", "t") == null && Updates.TokenFor(true, null, null) == null);
            Check("tag: dots alone refused", !Updates.ValidTag(".") && !Updates.ValidTag("..") && !Updates.ValidTag("...") && !Updates.ValidTag(null) && !Updates.ValidTag("a b") && !Updates.ValidTag("a/b"));
            Check("tag: release names kept", Updates.ValidTag("v2026.11.10-1432") && Updates.ValidTag(".v1") && Updates.ValidTag("a_b"));
            Check("release: a tag of dots refused", Updates.ParseRelease("{\"tag_name\":\"..\",\"assets\":[]}") == null);
            string err;
            Check("manifest: a part in release '..' refused", Updates.ParseManifest(Manifest("\"app\":" + Part("app.zip", "a", "..")), out err) == null && err.Contains("release"), err);

            // a 206 must continue the partial file
            Check("range: continues the partial file", Updates.ContentRangeOk("bytes 500-999/1000", 500, 1000));
            Check("range: another start refused", !Updates.ContentRangeOk("bytes 0-999/1000", 500, 1000) && !Updates.ContentRangeOk("bytes 400-999/1000", 500, 1000));
            Check("range: another size or end refused", !Updates.ContentRangeOk("bytes 500-999/2000", 500, 1000) && !Updates.ContentRangeOk("bytes 500-899/1000", 500, 1000));
            Check("range: missing or garbage refused", !Updates.ContentRangeOk(null, 500, 1000) && !Updates.ContentRangeOk("bytes */1000", 500, 1000));

            // the test base: a fake GitHub on this PC, over http, and nothing else
            bool api;
            Check("test base: http on loopback only", Updates.TestBaseOk("http://127.0.0.1:5000") && Updates.TestBaseOk("http://localhost:5000") && !Updates.TestBaseOk("https://127.0.0.1:5000") && !Updates.TestBaseOk("http://10.0.0.5:5000") && !Updates.TestBaseOk("http://example.com") && !Updates.TestBaseOk(null));
            Check("test base off this PC: every URL refused", !Updates.AllowedUrl("http://10.0.0.5:5000/repos", "http://10.0.0.5:5000", out api) && !Updates.AllowedUrl("https://api.github.com/x", "http://10.0.0.5:5000", out api));

            // a deferred update waits for 2 minutes with no game
            var now = new DateTime(2026, 11, 10, 12, 0, 0, DateTimeKind.Utc);
            Check("install: never during a game", !Updates.InstallNow(true, now.AddHours(-1), now, false) && !Updates.InstallNow(true, null, now, true));
            Check("install: asked for, no game: now", Updates.InstallNow(false, null, now, false));
            Check("install: deferred: not right after the game", !Updates.InstallNow(false, now.AddSeconds(-30), now, true) && !Updates.InstallNow(false, null, now, true));
            Check("install: deferred: 2 minutes after the game", Updates.InstallNow(false, now.AddMinutes(-2), now, true));

            // the undo deletes only what the update moved away or created
            var j = new Journal { Target = "v2", Backup = @"C:\pkg\backup\v1", Replaced = new List<string> { "bridge", "decks", "scenarios", "version.json", "stack/deployed.json" },
                Existed = new List<string> { "bridge", "decks", "version.json", "stack/deployed.json" }, Moved = new List<string> { "bridge" } };
            j.Placed.Add(new[] { "images/mtg-images.tar", @"C:\pkg\updates\v2\images.tar" });
            var u = Updates.Undo(j);
            Check("undo: a path that was there and wasn't moved is never deleted", !u.Delete.Contains("decks") && !u.Delete.Contains("version.json") && !u.Delete.Contains("stack/deployed.json"), string.Join(",", u.Delete));
            Check("undo: a moved path and a created one are deleted", u.Delete.Contains("bridge") && u.Delete.Contains("scenarios") && u.Delete.Count == 2, string.Join(",", u.Delete));
            Check("undo: only the moved paths go back", u.MoveBack.Count == 1 && u.MoveBack[0] == "bridge", string.Join(",", u.MoveBack));
            Check("undo: a placed download goes back to the download folder", u.ReturnToDownload.Count == 1 && u.ReturnToDownload[0][1].EndsWith("images.tar"));
            j.Phase = "placing";
            var back = Journal.FromJson(J.Parse(J.Write(j.ToJson())));
            Check("journal: written and read back whole", back != null && back.Target == "v2" && back.Backup == j.Backup && back.Phase == "placing" && back.Replaced.Count == 5 && back.Existed.Count == 4
                && back.Moved.Count == 1 && back.Placed.Count == 1 && back.Placed[0][0] == "images/mtg-images.tar", back == null ? "null" : J.Write(back.ToJson()));
            Check("journal: no backup folder: unreadable", Journal.FromJson(J.Parse("{\"target\":\"v2\"}")) == null && Journal.FromJson(null) == null);

            // stack\deployed.json: the ids this Docker gave the images stay unless the images changed
            var mine = J.Parse("{\"bridge\":\"b1\",\"node\":\"sha256:n1\",\"nodeConfig\":\"sha256:nc-here\",\"relayConfig\":\"sha256:rc-here\"}");
            var theirs = J.Parse("{\"bridge\":\"b2\",\"node\":\"sha256:n1\",\"nodeConfig\":\"sha256:nc\",\"relayConfig\":\"sha256:rc\"}");
            var merged = Updates.MergeDeployed(mine, theirs, false);
            Check("deployed: images unchanged: this PC's ids kept, the rest the release's", J.Str(merged, "nodeConfig") == "sha256:nc-here" && J.Str(merged, "relayConfig") == "sha256:rc-here" && J.Str(merged, "bridge") == "b2", J.Write(merged));
            merged = Updates.MergeDeployed(mine, theirs, true);
            Check("deployed: new images: the release's ids", J.Str(merged, "nodeConfig") == "sha256:nc" && J.Str(merged, "bridge") == "b2", J.Write(merged));

            // the swap waits for the old app itself, not a later process with its number
            Check("swap: the same start time is the old app", Updates.SameProcess(1000 * TimeSpan.TicksPerSecond, 1000 * TimeSpan.TicksPerSecond + 100) && Updates.SameProcess(0, 5));
            Check("swap: another start time is another process", !Updates.SameProcess(1000 * TimeSpan.TicksPerSecond, 1010 * TimeSpan.TicksPerSecond));
            string oldPath = @"C:\pkg\MTG Companion.exe", self = @"C:\pkg\" + Updater.NewExe;
            var ops = new FakeOps { FailAside = 3 };
            ops.Files.Add(oldPath); ops.Files.Add(self);
            Check("swap: the old exe still locked for a moment: retried, then swapped", Updater.SwapFiles(oldPath, self, ops) && ops.Files.Contains(oldPath) && ops.Files.Contains(@"C:\pkg\" + Updater.OldExe) && !ops.Files.Contains(self) && ops.Slept == 3, string.Join(",", ops.Files));
            ops = new FakeOps { FailAside = 50 };
            ops.Files.Add(oldPath); ops.Files.Add(self);
            Check("swap: locked for good: given up after 20 tries, the old exe in place", !Updater.SwapFiles(oldPath, self, ops) && ops.Files.Contains(oldPath) && ops.Slept == 19, ops.Slept);
            ops = new FakeOps { FailTakeName = true };
            ops.Files.Add(oldPath); ops.Files.Add(self);
            Check("swap: the new one can't take the name: the old exe put back", !Updater.SwapFiles(oldPath, self, ops) && ops.Files.Contains(oldPath) && !ops.Files.Contains(@"C:\pkg\" + Updater.OldExe), string.Join(",", ops.Files));

            // the manifest's signature (a vector from the packager's Node code, and a key made here)
            const string nodeKey = "4w4l1SZR71phfBRUhXcqlR4YLfGtHULpwc8aIxg56paGWyP2mawAWljSG0D2M0wAp1igtNUsslS8lYlWH8iCHg==";
            const string nodeSig = "Z5TpT6mOHeP5OyJbFH3p7ea9gSMs33pRjun+kueLaypZVg2gO+gyZ/OPsEU5SjjSUwRlFu+XUIQN2l1V/IMcpw==";
            var data = Encoding.UTF8.GetBytes("{\"format\":1,\"version\":\"v1\"}\n");
            Check("signature: the packager's (Node) signature verifies", Updates.VerifySignature(data, nodeSig, new[] { nodeKey }));
            var changed = (byte[])data.Clone(); changed[changed.Length - 2] ^= 1;
            Check("signature: one byte changed: refused", !Updates.VerifySignature(changed, nodeSig, new[] { nodeKey }));
            Check("signature: missing, short or garbage: refused", !Updates.VerifySignature(data, null, new[] { nodeKey }) && !Updates.VerifySignature(data, "", new[] { nodeKey }) && !Updates.VerifySignature(data, "not base64!", new[] { nodeKey })
                && !Updates.VerifySignature(data, Convert.ToBase64String(new byte[63]), new[] { nodeKey }));
            Check("signature: no trusted key: refused", !Updates.VerifySignature(data, nodeSig, new string[0]) && !Updates.VerifySignature(data, nodeSig, new[] { "AAAA" }));
            using (var k = new System.Security.Cryptography.ECDsaCng(256) { HashAlgorithm = System.Security.Cryptography.CngAlgorithm.Sha256 })
            {
                var blob = k.Key.Export(System.Security.Cryptography.CngKeyBlobFormat.EccPublicBlob);
                var other = Convert.ToBase64String(blob, 8, 64);
                var sig = Convert.ToBase64String(k.SignData(data));
                Check("signature: another key's signature refused; either of two keys accepted (a key change)", !Updates.VerifySignature(data, sig, new[] { nodeKey }) && Updates.VerifySignature(data, sig, new[] { nodeKey, other }) && Updates.VerifySignature(data, nodeSig, new[] { other, nodeKey }));
            }
            Check("keys file: comments and blank lines skipped", Updates.ParseKeys("# keys\r\n\r\n  " + nodeKey + "  \r\n#x\n").SequenceEqual(new[] { nodeKey }));

            // the token: DPAPI for this Windows user, not the machine
            var dir = Path.Combine(Path.GetTempPath(), "mtg-selftest-" + Guid.NewGuid().ToString("N"));
            try
            {
                TokenStore.Save(dir, "ghp_selftest");
                var b = File.ReadAllBytes(TokenStore.FileOf(dir));
                Check("token: DPAPI CurrentUser (not LocalMachine, which any account on the PC can read)", b.Length > 44 && (BitConverter.ToUInt32(b, 40) & 4) == 0 && TokenStore.Load(dir) == "ghp_selftest", BitConverter.ToUInt32(b, 40));
                TokenStore.Save(dir, " ");
                Check("token: an empty one removes the file", !File.Exists(TokenStore.FileOf(dir)) && TokenStore.Load(dir) == null);
            }
            finally { try { Directory.Delete(dir, true); } catch { } }
        }

        static void Misc()
        {
            sb.AppendLine("-- misc");
            Check("relay key from stack\\.env", Logic.RelayKey("FOO=1\r\nMANABREW_SERVER_KEY=\"s3cret\"\r\n") == "s3cret");
            Check("relay key default", Logic.RelayKey(null) == "tts-local" && Logic.RelayKey("MANABREW_SERVER_KEY=") == "tts-local");
            Check("worst light: red beats amber", Logic.Worst(new[] { Light.Green, Light.Amber, Light.Red }) == Light.Red);
            Check("worst light: all grey is grey", Logic.Worst(new[] { Light.Grey, Light.Grey }) == Light.Grey);
            Check("worst light: grey rows don't hide green", Logic.Worst(new[] { Light.Grey, Light.Green }) == Light.Green);
            var raw = Encoding.ASCII.GetBytes("HTTP/1.0 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n");
            var h = Probes.ParseHttp(raw, 1);
            Check("pipe HTTP: chunked body", h.Status == 200 && h.Body == "hello world", h.Body);
            h = Probes.ParseHttp(Encoding.ASCII.GetBytes("HTTP/1.0 404 Not Found\r\nContent-Type: application/json\r\n\r\n{\"message\":\"No such image\"}"), 1);
            Check("pipe HTTP: 404", h.Status == 404 && h.Body.Contains("No such image"), h.Status);
            Web(); // (the status page's server and API: SelfTestWeb.cs)
        }
    }
}
