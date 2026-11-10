// --selftest: the decision logic against canned inputs. Prints one line per case; the exit code is the failure count.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace MtgCompanion
{
    public static class SelfTest
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
            Modes(); Docker(); Images(); Stack(); Ports(); Bridge(); GameLock(); Saves(); Tts(); Wsl(); Misc();
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
        }
    }
}
