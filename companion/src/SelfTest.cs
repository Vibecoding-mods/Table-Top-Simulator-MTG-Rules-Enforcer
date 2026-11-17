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
            Modes(); Sequence(); Docker(); Images(); Stack(); Ports(); Bridge(); GameLock(); Saves(); Tts(); Wsl(); LogTrimChecks(); Misc(); Update(); UpdateSafety(); OwnServerChecks();
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

        static void Sequence()
        {
            sb.AppendLine("-- the start sequence after a stop");
            Check("no stop: a button starts where it asks", Logic.StartFrom(5, 0, false) == 5 && Logic.StartFrom(1, 0, false) == 1);
            Check("Start the bridge after the engine stopped it (still red): the engine step again, not step 5", Logic.StartFrom(5, 3, false) == 3, Logic.StartFrom(5, 3, false));
            Check("Start the bridge after the engine stopped it (green now): the save step, never skipped", Logic.StartFrom(5, 3, true) == 4, Logic.StartFrom(5, 3, true));
            Check("a button at or before the stopped step: unchanged", Logic.StartFrom(3, 3, true) == 3 && Logic.StartFrom(2, 3, false) == 2 && Logic.StartFrom(4, 4, false) == 4);
            Check("a button one past the stopped step that turned green: unchanged", Logic.StartFrom(4, 3, true) == 4);
            Check("a button one past the stopped step that is still red: the stopped step", Logic.StartFrom(4, 3, false) == 3, Logic.StartFrom(4, 3, false));
            // (the rule over every input, not a recorded answer: never later than asked, never past the first step not done)
            string broke = null;
            for (int req = 1; req <= 7 && broke == null; req++)
                for (int at = 0; at <= 6 && broke == null; at++)
                    foreach (bool green in new[] { false, true })
                    {
                        int got = Logic.StartFrom(req, at, green), firstUndone = at == 0 ? int.MaxValue : green ? at + 1 : at;
                        if (got > req || got > firstUndone || (got != req && got != firstUndone)) { broke = "StartFrom(" + req + ", " + at + ", " + green + ") = " + got; break; }
                    }
            Check("every button, every stop: the requested step or the first step not done, whichever is earlier", broke == null, broke);
            Check("resume: the stopped step turned green, carry on from the next", Logic.ResumeAfterStop(3, true, false) == 4, Logic.ResumeAfterStop(3, true, false));
            Check("resume: still red, or no stop, or observe mode: nothing", Logic.ResumeAfterStop(3, false, false) == 0 && Logic.ResumeAfterStop(0, true, false) == 0 && Logic.ResumeAfterStop(3, true, true) == 0);
            Check("resume after the last step: 7, a run that runs no step", Logic.ResumeAfterStop(6, true, false) == 7);
            Check("engine wait: at least twice the 2 min 15 s cold start of 2026-11-10", Logic.StackWaitSeconds >= 270, Logic.StackWaitSeconds);
            var timedOut = Logic.StackTimedOut("room busy");
            Check("engine wait: the red text names the wait in minutes", timedOut.Contains("within " + (Logic.StackWaitSeconds / 60) + " minutes: room busy"), timedOut);
            SequenceWiring();
        }

        // The Controller's own wiring of the two rules: the worker's turns (WorkOnce) on a Controller whose worker thread
        // never starts, with a fake watcher. --steps 4 runs only the table save, which stops red here (no
        // table\MTG Table.json in the temp package): no Docker, no bridge, no TTS. A run that started past step 4 would
        // skip every step and say Ready, so "stopped at 4" proves the save step ran. The presses used (Start the bridge,
        // Try again) only queue a step; the ones that probe the bridge or stop processes are never pressed here.
        static void SequenceWiring()
        {
            var tmp = Path.Combine(Path.GetTempPath(), "mtg-companion-selftest-" + Guid.NewGuid().ToString("N").Substring(0, 6));
            try
            {
                var c = new Controller(Layout.Make(Mode.Friend, tmp), false, Path.Combine(tmp, "saves"), Path.Combine(tmp, "state"), "x.exe");
                c.OnlySteps = new HashSet<int> { 4 };
                int watched = 0;
                Action watch = () => watched++;
                Check("wiring: before any run, no stop: a button starts where it asks", c.StoppedAt == 0 && c.StartAt(5) == 5, c.StoppedAt);
                bool ran = c.WorkOnce(watch);
                Check("launch: the first turn is the check, not the watcher and not the start sequence: no stop recorded, Not started", ran && watched == 0 && c.PendingFrom == 0 && c.StoppedAt == 0 && c.Phase == Logic.NotStartedPhase && c.NeedsStart && !c.EngineStarted, ran + " " + watched + " / " + c.StoppedAt + " / " + c.Phase);
                Check("launch: the check read the save step (red: no table here) and set no row waiting", c.Rows[Controller.StepSave].V.Light == Light.Red && c.Rows[Controller.StepTts].V.Text != "Waiting for Table save.", c.Rows[Controller.StepSave].V);
                ran = c.WorkOnce(watch);
                Check("launch: then only the watcher, nothing queued, still Not started", !ran && watched == 1 && c.PendingFrom == 0 && c.NeedsStart, ran + " " + watched + " / " + c.PendingFrom);
                Check("launch: Start engine queues a press (nothing runs until the worker takes it)", c.StartEngine() == null && c.QueuedWork == 1 && c.PendingFrom == 0);
                ran = c.WorkOnce(watch);
                Check("Start engine: the press is a turn of its own: it queues the start sequence from step 1", ran && c.PendingFrom == 1 && !c.NeedsStart, c.PendingFrom);
                watched = 0;
                ran = c.WorkOnce(watch);
                Check("wiring: Start engine's turn runs the start sequence, not the watcher; the red step is recorded", ran && watched == 0 && c.PendingFrom == 0 && c.StoppedAt == 4 && c.Phase.StartsWith("Stopped at step 4") && c.EngineStarted, ran + " " + watched + " / " + c.StoppedAt + " / " + c.Phase);
                Check("wiring: the steps after the stop wait for it", c.Rows[4].V.Light == Light.Grey && c.Rows[5].V.Text == "Waiting for Table save.", c.Rows[5].V);
                ran = c.WorkOnce(watch);
                Check("wiring: still red: a watcher turn, nothing queued", !ran && watched == 1 && c.PendingFrom == 0 && c.StoppedAt == 4, ran + " " + watched + " / " + c.PendingFrom);

                c.DoFix(Controller.StepBridge, Fixes.BridgeStart);
                ran = c.WorkOnce(watch);
                Check("wiring: a press is a turn of its own: it queues its step", ran && watched == 1 && c.PendingFrom == 5, c.PendingFrom);
                c.WorkOnce(watch);
                Check("wiring: Start the bridge while the save is red: the save step again, not step 5", c.StoppedAt == 4 && c.Phase.StartsWith("Stopped at step 4"), c.StoppedAt + " / " + c.Phase);

                // the bridge row's button pressed again while the run is on the unfinished step (on 2026-11-10: the
                // 5-minute engine wait); the press arrives as the run starts that step
                bool pressed = false;
                Action press = () => { if (!pressed && c.Phase == "Starting: step 4 of 6") { pressed = true; c.DoFix(Controller.StepBridge, Fixes.Retry); } };
                c.DoFix(Controller.StepBridge, Fixes.BridgeStart);
                c.WorkOnce(watch); // the press
                c.Changed += press;
                c.WorkOnce(watch); // the run, interrupted by the second press
                c.Changed -= press;
                Check("wiring: a press during a run interrupts it, and the unfinished step is remembered", pressed && c.Phase == "Interrupted" && c.StoppedAt == 4, pressed + " / " + c.Phase + " / " + c.StoppedAt);
                c.WorkOnce(watch); // the second press (Try again on the bridge row: step 5)
                c.WorkOnce(watch); // its run
                Check("wiring: pressed again during the run: the interrupted step still runs first, never skipped", c.StoppedAt == 4 && c.Phase.StartsWith("Stopped at step 4"), c.StoppedAt + " / " + c.Phase);

                // a press for an EARLIER step during a run (Try again on the Docker row): the next run starts there, not
                // at the interrupted step (a run from step 1 marks steps 1-3 skipped; a run from 4 leaves the marker)
                c.Rows[Controller.StepDocker].V = new Verdict(Light.Red, "marker");
                pressed = false;
                Action pressEarly = () => { if (!pressed && c.Phase == "Starting: step 4 of 6") { pressed = true; c.DoFix(Controller.StepDocker, Fixes.Retry); } };
                c.DoFix(Controller.StepBridge, Fixes.BridgeStart);
                c.WorkOnce(watch); // the press
                c.Changed += pressEarly;
                c.WorkOnce(watch); // the run, interrupted
                c.Changed -= pressEarly;
                c.WorkOnce(watch); // Try again on Docker: step 1
                c.WorkOnce(watch); // its run
                Check("wiring: a press for an earlier step during a run: the next run starts there", pressed && c.Rows[Controller.StepDocker].V.Text == "Skipped (--steps)." && c.StoppedAt == 4, pressed + " / " + c.Rows[Controller.StepDocker].V.Text + " / " + c.StoppedAt);

                c.Rows[Controller.StepSave].V = new Verdict(Light.Green, "Installed.");
                Check("wiring: the stopped step's light is what counts (green; other rows never)", c.StepGreen(4) && !c.StepGreen(3) && !c.StepGreen(0) && !c.StepGreen(7));
                var tts = c.Rows[Controller.StepTts].V;
                c.Rows[Controller.StepTts].V = new Verdict(Light.Green, "TTS.");
                Check("wiring: step 6 (the last row) can be green too", c.StepGreen(6) && !c.StepGreen(5));
                c.Rows[Controller.StepTts].V = tts;
                Check("wiring: green now: a button for a later step starts after it", c.StartAt(6) == 5 && c.StartAt(2) == 2, c.StartAt(6));
                c.Rows[Controller.StepSave].V = new Verdict(Light.Red, "Not yet.");
                // the watcher is what turns the light green (as MonitorTick re-reads a row); the carry-on check comes after it
                Action greenWatch = () => { watched++; c.Rows[Controller.StepSave].V = new Verdict(Light.Green, "Installed."); };
                ran = c.WorkOnce(greenWatch);
                Check("wiring: the watcher's turn that sees it green queues the next step", !ran && c.PendingFrom == 5, ran + " / " + c.PendingFrom);
                ran = c.WorkOnce(watch);
                Check("wiring: the run that carries on forgets the stop", ran && c.StoppedAt == 0 && c.PendingFrom == 0 && c.Phase == "Ready", c.StoppedAt + " / " + c.Phase);
                int before = watched;
                ran = c.WorkOnce(watch);
                Check("wiring: no second carry-on: the next turn only watches", !ran && watched == before + 1 && c.PendingFrom == 0, ran + " / " + c.PendingFrom);

                // after Stop everything the watcher pauses, but the TTS row still follows TTS (it stays open)
                c.EverythingStopped = true;
                c.TtsProbe = () => true;
                before = watched;
                ran = c.WorkOnce(watch);
                Check("wiring: stopped: the watcher pauses, the TTS row says TTS runs", !ran && watched == before && c.Rows[Controller.StepTts].V.Light == Light.Green && c.Rows[Controller.StepTts].V.Text.StartsWith("Tabletop Simulator is running"), watched + " / " + c.Rows[Controller.StepTts].V);
                c.TtsProbe = () => false;
                c.WorkOnce(watch);
                Check("wiring: stopped: TTS closed later: the row follows", watched == before && c.Rows[Controller.StepTts].V.Light == Light.Grey && c.Rows[Controller.StepTts].V.Text == "Tabletop Simulator isn't running.", c.Rows[Controller.StepTts].V);
                c.EverythingStopped = false;

                // a run already queued (the watcher's update install queues one from step 1) is kept, not replaced
                var u = new Controller(Layout.Make(Mode.Friend, tmp), false, Path.Combine(tmp, "saves"), Path.Combine(tmp, "state-u"), "x.exe");
                u.OnlySteps = new HashSet<int> { 4 };
                u.StartEngine();
                u.WorkOnce(watch); // (the press: a run from step 1 queued)
                u.RunSequence(1); // (that queued run, from step 1, not consumed)
                u.Rows[Controller.StepSave].V = new Verdict(Light.Green, "Installed.");
                u.ResumeIfGreen();
                Check("wiring: a run already queued is kept, not replaced by the carry-on", u.StoppedAt == 4 && u.PendingFrom == 1 && u.StartAt(1) == 1, u.StoppedAt + " / " + u.PendingFrom);

                var o = new Controller(Layout.Make(Mode.Friend, tmp), true, tmp, Path.Combine(tmp, "state-o"), "x.exe");
                o.OnlySteps = new HashSet<int> { 4 };
                o.WorkOnce(watch); // its first run: the save red, observed
                o.Rows[Controller.StepSave].V = new Verdict(Light.Green, "Installed.");
                o.WorkOnce(watch);
                Check("wiring: observe mode never records a stop, so never carries on", o.StoppedAt == 0 && o.PendingFrom == 0 && o.Phase == "Observing (no changes)", o.StoppedAt + " / " + o.PendingFrom + " / " + o.Phase);
            }
            catch (Exception e) { Check("wiring: no exception", false, e); }
            finally { try { if (Directory.Exists(tmp)) Directory.Delete(tmp, true); } catch { } }
            LaunchStartsNothing();
            StartEngineRules();
        }

        // Launch only checks (2026-11-14: "I don't want it to start on click of the app"). The table save is the one step
        // that changes something without Docker, so it is the proof: a package with a table, --steps 4. The launch's check
        // installs nothing; Start engine installs it; --start (AutoStart) installs it at launch as every launch did before.
        static void LaunchStartsNothing()
        {
            var tmp = Path.Combine(Path.GetTempPath(), "mtg-companion-selftest-" + Guid.NewGuid().ToString("N").Substring(0, 6));
            try
            {
                var l = Layout.Make(Mode.Friend, tmp);
                // the host's Workshop copy beside the Saves folders (tmp\saves*), and a patcher that makes the table
                Directory.CreateDirectory(Path.Combine(tmp, "Mods", "Workshop"));
                File.WriteAllText(Path.Combine(tmp, "Mods", "Workshop", Logic.TableWorkshopId + ".json"), "{\"SaveName\": \"The Workshop table\"}");
                Func<string, string, TableBuild> fake = (ws, outFile) => { File.WriteAllText(outFile, "{\"SaveName\": \"Selftest table\", \"ObjectStates\": []}"); return new TableBuild { Ok = true, Stamp = "t1" }; };
                string saves = Path.Combine(tmp, "saves");
                Func<string, int> filesIn = d => Directory.Exists(d) ? Directory.GetFiles(d).Length : 0;
                var c = new Controller(l, false, saves, Path.Combine(tmp, "state"), "x.exe");
                c.OnlySteps = new HashSet<int> { 4 };
                c.BuildTable = fake; c.SteamDir = null;
                int watched = 0;
                Action watch = () => watched++;
                c.WorkOnce(watch);
                Check("launch starts nothing: the check installed no table save", filesIn(saves) == 0, filesIn(saves));
                Check("launch starts nothing: the save row is grey and says Start engine does it", c.Rows[Controller.StepSave].V.Light == Light.Grey && c.Rows[Controller.StepSave].V.Text == "Start engine does this: Installing the table as TS_Save_1.json.", c.Rows[Controller.StepSave].V);
                Check("launch starts nothing: Not started, nothing queued, not started", c.Phase == Logic.NotStartedPhase && c.PendingFrom == 0 && c.NeedsStart && !c.EngineStarted, c.Phase);
                Check("launch starts nothing: the check made the table in a temp file, not in the package", !File.Exists(l.TableJson));
                c.WorkOnce(watch); c.WorkOnce(watch);
                Check("launch starts nothing: the watcher's turns install nothing either", watched == 2 && filesIn(saves) == 0, watched + " / " + filesIn(saves));
                c.StartEngine();
                c.WorkOnce(watch); // the press
                c.WorkOnce(watch); // the start sequence
                Check("Start engine: the table save installed (TS_Save_1.json), the row green, Ready", File.Exists(Path.Combine(saves, "TS_Save_1.json")) && c.Rows[Controller.StepSave].V.Light == Light.Green && c.Phase == "Ready" && c.EngineStarted && !c.NeedsStart, c.Rows[Controller.StepSave].V + " / " + c.Phase);

                string saves2 = Path.Combine(tmp, "saves2");
                var a = new Controller(l, false, saves2, Path.Combine(tmp, "state2"), "x.exe");
                a.OnlySteps = new HashSet<int> { 4 };
                a.BuildTable = fake; a.SteamDir = null;
                a.AutoStart = true;
                bool ran = a.WorkOnce(watch);
                Check("--start: the launch's first turn is the start sequence: the save installed, Ready", ran && File.Exists(Path.Combine(saves2, "TS_Save_1.json")) && a.Phase == "Ready" && a.EngineStarted, a.Phase + " / " + filesIn(saves2));

                string saves3 = Path.Combine(tmp, "saves3");
                var o = new Controller(l, true, saves3, Path.Combine(tmp, "state3"), "x.exe");
                o.OnlySteps = new HashSet<int> { 4 };
                o.BuildTable = fake; o.SteamDir = null;
                o.AutoStart = true;
                o.WorkOnce(watch);
                Check("--observe beats --start: nothing installed, Observing", filesIn(saves3) == 0 && o.Phase == "Observing (no changes)" && !o.NeedsStart && o.StartEngine() != null, o.Phase);
            }
            catch (Exception e) { Check("launch starts nothing: no exception", false, e); }
            finally { try { if (Directory.Exists(tmp)) Directory.Delete(tmp, true); } catch { } }
            WorkshopTable();
        }

        // The table save made from the host's own Workshop copy (the package ships no table): the copy missing, the
        // patcher refusing it, a copy that makes another table than the package's, and the pure parts
        static void WorkshopTable()
        {
            sb.AppendLine("-- the table from the host's Workshop copy");
            var cand = Logic.WorkshopCandidates(@"C:\U\Documents\My Games\Tabletop Simulator\Saves", @"D:\Steam", "2296042369");
            Check("Workshop: beside Saves first, then the game's own folder (TTS's Game Data mod location)", cand.Count == 2
                && cand[0] == @"C:\U\Documents\My Games\Tabletop Simulator\Mods\Workshop\2296042369.json"
                && cand[1] == @"D:\Steam\steamapps\common\Tabletop Simulator\Tabletop Simulator_Data\Mods\Workshop\2296042369.json", string.Join(" | ", cand));
            Check("Workshop: no Steam found: only beside Saves", Logic.WorkshopCandidates(@"C:\S\Saves", null, "1").Count == 1);
            var miss = Logic.WorkshopMissing(Logic.WorkshopUrl(Logic.TableWorkshopId), cand);
            Check("Workshop missing: red, the link, what to do, Try again", miss.Light == Light.Red && miss.Fix == Fixes.Retry
                && miss.Text == "Subscribe to the table on the Steam Workshop: https://steamcommunity.com/sharedfiles/filedetails/?id=2296042369, start TTS once so it downloads, then press Try again.", miss);
            Check("Workshop missing: the hint names where it looked", miss.Hint != null && miss.Hint.Contains(cand[0]) && miss.Hint.Contains(cand[1]), miss.Hint);
            Check("the 6-player table's link is ready for its profile", Logic.WorkshopUrl(Logic.SixWorkshopId) == "https://steamcommunity.com/sharedfiles/filedetails/?id=2293586471");
            Check("make-table: the command line quotes every path", Logic.MakeTableArgs(@"C:\P q\table\make-table.js", @"C:\W\1.json", @"C:\P q\table\MTG Table.json") == "\"C:\\P q\\table\\make-table.js\" \"C:\\W\\1.json\" \"C:\\P q\\table\\MTG Table.json\"");
            var ok = Logic.ParseMakeTable(0, "noise\n{\"ok\":true,\"table\":\"4p\",\"stamp\":\"5a6fd66e\",\"save\":\"09d84816\",\"workshop\":\"e502cd67\"}\n");
            Check("make-table: its JSON line read", ok.Ok && ok.Stamp == "5a6fd66e" && ok.Save == "09d84816" && ok.Workshop == "e502cd67" && ok.Error == null, ok.Error);
            var gone = Logic.ParseMakeTable(3, "{\"ok\":false,\"missing\":true,\"error\":\"x isn't there\"}");
            Check("make-table: the Workshop file gone", !gone.Ok && gone.Missing && gone.Error == "x isn't there");
            var bad = Logic.ParseMakeTable(1, "{\"ok\":false,\"error\":\"a patch didn't apply to this Workshop copy: FAIL Draw\"}");
            Check("make-table: a patch that didn't apply", !bad.Ok && !bad.Missing && bad.Error.Contains("FAIL Draw"));
            Check("make-table: ok:true but a non-zero exit is a failure", !Logic.ParseMakeTable(1, "{\"ok\":true}").Ok);
            var none = Logic.ParseMakeTable(1, "Error: Cannot find module");
            Check("make-table: no JSON line: a failure that says what it printed", !none.Ok && none.Error.Contains("Cannot find module"), none.Error);
            var refused = Logic.TableBuildFailed(bad);
            Check("make-table failed: red, why, Try again, and a hint about the Workshop table changing", refused.Light == Light.Red && refused.Text.Contains("FAIL Draw") && refused.Fix == Fixes.Retry && refused.Hint.Contains("newer"), refused);
            Check("save done: the package's table: green", Logic.SaveDone("Installed.", "s1", "s1", "t1", "t1").Light == Light.Green);
            Check("save done: no package hash to compare: green", Logic.SaveDone("Installed.", "s1", null, "t1", null).Light == Light.Green);
            var other = Logic.SaveDone("Installed.", "s2", "s1", "t2", "t1");
            Check("save done: another Workshop copy made another table: amber, says both", other.Light == Light.Amber && other.Text.StartsWith("Installed.") && other.Text.Contains("t2") && other.Text.Contains("t1"), other);
            var dep = new Dictionary<string, object> { { "table", "t1" }, { "bridge", "b" } };
            var next = Logic.DeployedWithTable(dep, "t2");
            Check("deployed.json: the host's table, the package's kept as tablePackage", next != null && J.Str(next, "table") == "t2" && J.Str(next, "tablePackage") == "t1" && J.Str(next, "bridge") == "b" && J.Str(dep, "table") == "t1");
            Check("deployed.json: already the host's: no rewrite", Logic.DeployedWithTable(dep, "t1") == null && Logic.DeployedWithTable(null, "t2") == null);
            Check("deployed.json: the package's own table kept on a second rewrite", J.Str(Logic.DeployedWithTable(next, "t3"), "tablePackage") == "t1");
            var notInstalled = Logic.DecideDocker(new DockerFacts());
            var slow = Logic.DecideDocker(new DockerFacts { CliFound = true, DesktopFound = true, Waiting = true, WaitedSec = 200 });
            Check("Docker: not installed: the hint says All-users installation and Virtual Machine Platform", notInstalled.Hint.Contains("All-users installation") && notInstalled.Hint.Contains("Virtual Machine Platform") && notInstalled.Hint.Contains("wsl --install"), notInstalled.Hint);
            Check("Docker: 3 minutes and no answer: the hint says Virtual Machine Platform and SVM / VT-x", slow.Light == Light.Red && slow.Hint != null && slow.Hint.Contains("Virtual Machine Platform") && slow.Hint.Contains("SVM") && slow.Hint.Contains("VT-x"), slow.Hint);

            // the controller's save step on a temp package: --steps 4 only
            var tmp = Path.Combine(Path.GetTempPath(), "mtg-companion-selftest-" + Guid.NewGuid().ToString("N").Substring(0, 6));
            try
            {
                var l = Layout.Make(Mode.Friend, tmp);
                Directory.CreateDirectory(Path.Combine(tmp, "stack"));
                File.WriteAllText(Path.Combine(tmp, "version.json"), "{\"table\": \"t1\", \"save\": \"" + Logic.Sha8(Encoding.UTF8.GetBytes("{\"SaveName\": \"MTG Table (rules engine)\", \"v\": 1}")) + "\", \"workshop\": {\"id\": \"2296042369\", \"url\": \"https://steamcommunity.com/sharedfiles/filedetails/?id=2296042369\"}}");
                File.WriteAllText(l.DeployedFile, "{\"table\": \"t1\", \"bridge\": \"b\"}");
                string saves = Path.Combine(tmp, "Saves");
                Func<int> savesCount = () => Directory.Exists(saves) ? Directory.GetFiles(saves, "*.json").Length : 0;
                string ws = Path.Combine(tmp, "Mods", "Workshop", Logic.TableWorkshopId + ".json");
                string body = "{\"SaveName\": \"MTG Table (rules engine)\", \"v\": 1}", stamp = "t1";
                bool refuse = false; int runs = 0; string seenWs = null;
                Func<string, string, TableBuild> patcher = (w, outFile) =>
                {
                    runs++; seenWs = w;
                    if (refuse) return new TableBuild { Error = "a patch didn't apply to this Workshop copy: FAIL Draw" };
                    File.WriteAllText(outFile, body);
                    return new TableBuild { Ok = true, Stamp = stamp };
                };
                Func<Controller> make = () => { var x = new Controller(l, false, saves, Path.Combine(tmp, "state"), "x.exe"); x.OnlySteps = new HashSet<int> { 4 }; x.BuildTable = patcher; x.SteamDir = null; x.AutoStart = true; return x; };
                var c = make();
                c.WorkOnce(() => { });
                Check("no Workshop copy: the save step is red with the subscribe hint, the patcher never ran, nothing installed", c.Rows[Controller.StepSave].V.Light == Light.Red && c.Rows[Controller.StepSave].V.Text.StartsWith("Subscribe to the table on the Steam Workshop: https://steamcommunity.com/sharedfiles/filedetails/?id=2296042369") && runs == 0 && savesCount() == 0, c.Rows[Controller.StepSave].V);
                Directory.CreateDirectory(Path.GetDirectoryName(ws));
                File.WriteAllText(ws, "{}");
                refuse = true;
                c = make(); c.WorkOnce(() => { });
                Check("the patcher refuses the copy: red with its reason, nothing installed", c.Rows[Controller.StepSave].V.Light == Light.Red && c.Rows[Controller.StepSave].V.Text.Contains("FAIL Draw") && runs == 1 && savesCount() == 0, c.Rows[Controller.StepSave].V);
                refuse = false;
                c = make(); c.WorkOnce(() => { });
                Check("the package's table from the Workshop copy: green, installed, made from the file found", c.Rows[Controller.StepSave].V.Light == Light.Green && savesCount() == 1 && File.ReadAllText(Path.Combine(saves, "TS_Save_1.json")) == body && seenWs == ws, c.Rows[Controller.StepSave].V);
                Check("the table it made stays in the package's table folder (the save name, the TTS light)", File.Exists(l.TableJson) && File.ReadAllText(l.TableJson) == body);
                Check("the package's deployed.json untouched while the table is the package's", J.Str(J.Parse(File.ReadAllText(l.DeployedFile)), "table") == "t1");
                body = "{\"SaveName\": \"MTG Table (rules engine)\", \"v\": 2}"; stamp = "t9";
                // (an update asks the bridge whether a game is on: pointed at a port nothing listens on, never the real one)
                string realBridge = Controller.BridgeUrl;
                Controller.BridgeUrl = "http://127.0.0.1:9";
                try { c = make(); c.WorkOnce(() => { }); } finally { Controller.BridgeUrl = realBridge; }
                var v = c.Rows[Controller.StepSave].V;
                Check("another Workshop copy (its author changed it): installed over our untouched save, amber, says both tables", v.Light == Light.Amber && v.Text.Contains("t9") && v.Text.Contains("t1") && File.ReadAllText(Path.Combine(saves, "TS_Save_1.json")) == body && savesCount() == 1, v);
                var dj = J.Parse(File.ReadAllText(l.DeployedFile));
                Check("another Workshop copy: deployed.json says the host's table (the bridge compares with it), the package's kept", J.Str(dj, "table") == "t9" && J.Str(dj, "tablePackage") == "t1" && J.Str(dj, "bridge") == "b", J.Write(dj));
                File.Delete(ws);
                c = make(); c.WorkOnce(() => { });
                Check("the Workshop copy unsubscribed later: red again, the installed save left alone", c.Rows[Controller.StepSave].V.Light == Light.Red && File.ReadAllText(Path.Combine(saves, "TS_Save_1.json")) == body, c.Rows[Controller.StepSave].V);
            }
            catch (Exception e) { Check("Workshop table: no exception", false, e); }
            finally { try { if (Directory.Exists(tmp)) Directory.Delete(tmp, true); } catch { } }
        }

        static void StartEngineRules()
        {
            Check("--start: the flags that start at launch (--start, a self-update's restart); none: launch only checks",
                Program.AutoStart(new[] { "--start" }) && Program.AutoStart(new[] { "--after-update" }) && Program.AutoStart(new[] { "--apply-update", "v1.2" })
                && !Program.AutoStart(new string[0]) && !Program.AutoStart(new[] { "--observe" }) && !Program.AutoStart(new[] { "--no-browser", "--web-port", "0" }));
            var notRunning = Logic.DecideDocker(new DockerFacts { CliFound = true, DesktopFound = true });
            var bs = Logic.BeforeStart(Controller.StepDocker, notRunning);
            Check("before start: Docker not running: grey, points at Start engine (no red, no balloon)", notRunning.Action == Actions.StartDesktop && bs.Light == Light.Grey && bs.Text.Contains("Start engine") && bs.Fix == null, bs);
            var missing = Logic.DecideDocker(new DockerFacts());
            Check("before start: Docker not installed is a real problem: kept red with its hint", Logic.BeforeStart(Controller.StepDocker, missing) == missing && missing.Light == Light.Red && missing.Hint != null);
            var noRelay = Logic.DecideStack(null, null, null, Game.None("No game."));
            var bsStack = Logic.BeforeStart(Controller.StepStack, noRelay);
            Check("before start: no relay container: grey, Start engine", bsStack.Light == Light.Grey && bsStack.Text.Contains("Start engine"), bsStack);
            var unhealthy = Logic.DecideStack(new ContainerInfo { Exists = true, State = "running", Health = "unhealthy" }, new ContainerInfo { Exists = true, State = "running" }, null, Game.None("No game."));
            Check("before start: an unhealthy relay is a real problem: kept red", Logic.BeforeStart(Controller.StepStack, unhealthy) == unhealthy && unhealthy.Light == Light.Red);
            var noBridge = Logic.DecideBridge(new HttpResult { Kind = HttpKind.Refused }, null, false, null, true);
            var bsBridge = Logic.BeforeStart(Controller.StepBridge, noBridge);
            Check("before start: no bridge: grey, Start engine (no StartBridge action left to act on)", noBridge.Action == Actions.StartBridge && bsBridge.Light == Light.Grey && bsBridge.Action == null && bsBridge.Text.Contains("Start engine"), bsBridge);
            var port = new Verdict(Light.Red, "node.exe holds port 39998.").WithFix(Fixes.ShowProgram, "Show the program");
            Check("before start: a port taken is a real problem: kept", Logic.BeforeStart(Controller.StepBridge, port) == port);
            var load = Logic.DecideImages(new ImageFacts { Friend = true, TarPath = "x.tar" });
            Check("before start: images to load: grey, Start engine loads them", load.Action == Actions.Load && Logic.BeforeStart(Controller.StepImages, load).Light == Light.Grey);
            var tts = new Verdict(Light.Amber, "Tabletop Simulator isn't running.").WithFix(Fixes.TtsOpen, "Open TTS");
            Check("before start: the TTS row is left as it is (its Open TTS button too)", Logic.BeforeStart(Controller.StepTts, tts) == tts);
            Check("engine up: Docker, images, stack and bridge green (save and TTS don't count)", Logic.EngineUp(new[] { Light.Green, Light.Green, Light.Green, Light.Grey, Light.Green, Light.Amber })
                && !Logic.EngineUp(new[] { Light.Green, Light.Green, Light.Grey, Light.Green, Light.Green, Light.Green }) && !Logic.EngineUp(new[] { Light.Green, Light.Green, Light.Green, Light.Green, Light.Grey, Light.Green }));
            var rows = new[] { bs, new Verdict(Light.Grey, "x"), bsStack, new Verdict(Light.Grey, "y"), bsBridge, tts.WithHint("In TTS: Create") };
            Check("what to do next: before start: press Start engine (not the TTS row's hint)", Logic.NextHint(rows, true, "T") == Logic.StartHint && Logic.StartHint.StartsWith("The engine isn't running. Press Start engine"));
            Check("what to do next: after start: the first amber/red hint, as before", Logic.NextHint(rows, false, "T") == "In TTS: Create");
            rows[0] = missing;
            Check("what to do next: before start, a red light with a hint comes first", Logic.NextHint(rows, true, "T") == missing.Hint);
            Check("what to do next: nothing to say: how to load the table", Logic.NextHint(new[] { new Verdict(Light.Green, "ok") }, false, "My table").StartsWith(Logic.TtsHowTo("My table") + "\n\nOnly the host"));
            Check("APPDATA for the bridge: set from Windows' folder only when this app has none", Logic.AppDataFor(null, "C:\\Roaming") == "C:\\Roaming" && Logic.AppDataFor("", "C:\\Roaming") == "C:\\Roaming"
                && Logic.AppDataFor("D:\\Mine", "C:\\Roaming") == null && Logic.AppDataFor(null, "") == null);
        }

        static void Stack()
        {
            sb.AppendLine("-- engine stack");
            Check("relay heal: two broken logins, no game: restart relay and room", Logic.HealRelayNow(2, false, false, 60));
            Check("relay heal: one broken login, a game (or can't tell), observe, or a heal 5 min ago: no", !Logic.HealRelayNow(1, false, false, 60) && !Logic.HealRelayNow(5, true, false, 60) && !Logic.HealRelayNow(5, false, true, 60) && !Logic.HealRelayNow(5, false, false, 5));
            Check("relay heal: broken is closed/refused/timeout/error, never ok, a wrong key or no probe", Logic.LoginBroken(LoginKind.Closed) && Logic.LoginBroken(LoginKind.Refused) && Logic.LoginBroken(LoginKind.Timeout) && Logic.LoginBroken(LoginKind.Error) && !Logic.LoginBroken(LoginKind.Ok) && !Logic.LoginBroken(LoginKind.AuthFailed) && !Logic.LoginBroken(LoginKind.Skipped));
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
            // (the banner: everyone and the AI seats, not "1 seats." for one person and two AI; live check 2026-11-11)
            g = Logic.DecideGame(State("{\"started\":true,\"seats\":[{\"turn\":6}],\"players\":3,\"ai\":2}"), null);
            Check("banner: one person and two AI: 3 players (2 AI)", g.Text == "Game on: turn 6, 3 players (2 AI).", g.Text);
            g = Logic.DecideGame(State("{\"started\":true,\"seats\":[{\"turn\":6},{\"turn\":6}],\"players\":2,\"ai\":0}"), null);
            Check("banner: two people, no AI: no AI part", g.Text == "Game on: turn 6, 2 players.", g.Text);
            g = Logic.DecideGame(State("{\"started\":true,\"seats\":[{\"turn\":4}]}"), null);
            Check("banner: an older bridge without the counts: its seats, singular for one", g.Text == "Game on: turn 4, 1 player.", g.Text);
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
            // another program on port 48787 (break-it test 2026-11-13): no bridge runs, so no game, not "can't tell"
            Func<string, string, Func<IList<Listener>>> on48787 = (name, cmd) => () => new List<Listener> { new Listener { Port = 48787, Pid = 7, Name = name, CommandLine = cmd } };
            g = Logic.DecideGame(Logic.StateForLock(HttpResult.Of(HttpKind.Timeout), on48787("node", "node C:\\x\\occupy.js 48787")), null);
            Check("port lock: a non-bridge node holds 48787, /state times out: no game, unlocked", g.Kind == GameKind.None && !Logic.Locked(g), g.Text);
            g = Logic.DecideGame(Logic.StateForLock(new HttpResult { Kind = HttpKind.Ok, Status = 404, Body = "nope" }, on48787("Code", null)), null);
            Check("port lock: another program answers 404 on 48787: no game, unlocked", g.Kind == GameKind.None, g.Text);
            g = Logic.DecideGame(Logic.StateForLock(HttpResult.Of(HttpKind.Timeout), on48787("node", "node C:\\x\\occupy.js")), 15);
            Check("port lock: foreign holder but a fresh resume file: still locked", Logic.Locked(g), g.Text);
            g = Logic.DecideGame(Logic.StateForLock(HttpResult.Of(HttpKind.Timeout), on48787("node", "node --x C:\\r\\bridge\\bridge.js")), null);
            Check("port lock: a bridge holds 48787 and times out: still can't tell", g.Kind == GameKind.CantTell, g.Text);
            g = Logic.DecideGame(Logic.StateForLock(HttpResult.Of(HttpKind.Timeout), on48787("node", null)), null);
            Check("port lock: a node whose command line can't be read: still can't tell", g.Kind == GameKind.CantTell, g.Text);
            g = Logic.DecideGame(Logic.StateForLock(HttpResult.Of(HttpKind.Timeout), () => new List<Listener>()), null);
            Check("port lock: nobody listed on 48787: still can't tell", g.Kind == GameKind.CantTell, g.Text);
            Func<IList<Listener>> twoOn48787 = () => new List<Listener> { new Listener { Port = 48787, Pid = 7, Name = "Code", CommandLine = "code" }, new Listener { Port = 48787, Pid = 8, Name = "node", CommandLine = "node C:\\r\\bridge\\bridge.js" } };
            g = Logic.DecideGame(Logic.StateForLock(HttpResult.Of(HttpKind.Timeout), twoOn48787), null);
            Check("port lock: a foreign program on IPv4 and a bridge on IPv6: still can't tell", g.Kind == GameKind.CantTell, g.Text);
            g = Logic.DecideGame(Logic.StateForLock(HttpResult.Of(HttpKind.Timeout), on48787("node", "")), null);
            Check("port lock: a node with an empty command line: still can't tell", g.Kind == GameKind.CantTell, g.Text);
            g = Logic.DecideGame(Logic.StateForLock(HttpResult.Of(HttpKind.Timeout), () => { throw new InvalidOperationException("wmi"); }), null);
            Check("port lock: the port read throws: still can't tell, no throw", g.Kind == GameKind.CantTell, g.Text);
            var okState = State("{\"started\":true,\"seats\":[{\"turn\":2}]}");
            Check("port lock: a good /state answer is used as it is (ports not read)", Logic.StateForLock(okState, () => { throw new InvalidOperationException("read"); }) == okState);
            Check("restart label: can't tell says so, not 'game on'", Logic.RestartLabel(Game.CantTell("slow")) == "Restart engine (locked: can't tell)" && Logic.RestartLabel(Game.On("x", 1)) == "Restart engine (locked: game on)" && Logic.RestartLabel(Game.None("No game.")) == "Restart engine", Logic.RestartLabel(Game.CantTell("slow")));

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
            // (live check 2026-11-11: TTS relaunched 30 s ago, still on its main menu; the stamp the bridge holds was said
            // 10 minutes ago by the previous TTS: not green)
            v = Logic.DecideTts(new TtsFacts { Running = true, VersionsOk = true, TableHeard = true, Table = "0fa50b21", WantTable = "0fa50b21", TableHeardAgoSec = 600, TtsUpSec = 30, SaveName = "MTG Table (rules engine)" });
            Check("a table heard before this TTS started: amber, load the table", v.Light == Light.Amber && v.Text.Contains("isn't loaded") && v.Text.Contains("Save & Load"), v);
            v = Logic.DecideTts(new TtsFacts { Running = true, VersionsOk = true, TableHeard = true, Table = "0fa50b21", WantTable = "0fa50b21", TableHeardAgoSec = 20, TtsUpSec = 90 });
            Check("a table heard since this TTS started: green", v.Light == Light.Green, v);
            v = Logic.DecideTts(new TtsFacts { Running = true, VersionsOk = true, TableHeard = true, Table = "0fa50b21", WantTable = "0fa50b21", TableHeardAgoSec = 600, TtsUpSec = null });
            Check("TTS start time unknown: the stamp decides, as before", v.Light == Light.Green, v);
            v = Logic.DecideTts(new TtsFacts { Running = true, VersionsOk = true, TableHeard = true, Table = "0fa50b21", WantTable = "0fa50b21", TableHeardAgoSec = 92, TtsUpSec = 90 });
            Check("heard just as TTS started (the two readings seconds apart): green", v.Light == Light.Green, v);
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

        static void LogTrimChecks()
        {
            sb.AppendLine("-- log trim (every 14 days, between games)");
            var now = new DateTime(2026, 11, 13, 12, 0, 0, DateTimeKind.Utc);
            Check("trim due: no stamp", Logic.TrimDue(null, now));
            Check("trim not due: 13 days 23 hours", !Logic.TrimDue(now.AddDays(-14).AddHours(1), now));
            Check("trim due: 14 days", Logic.TrimDue(now.AddDays(-14), now));
            Check("trim due: a stamp 2 days ahead of the clock", Logic.TrimDue(now.AddDays(2), now));
            Check("trim not due: a stamp an hour ahead (clock drift)", !Logic.TrimDue(now.AddHours(1), now));
            var st = Logic.ParseTrimStamp(Logic.TrimStampText(now));
            Check("stamp: round trip, UTC", st.HasValue && st.Value == now && st.Value.Kind == DateTimeKind.Utc, st);
            Check("stamp: garbage or empty reads as none", Logic.ParseTrimStamp("not a date") == null && Logic.ParseTrimStamp("") == null && Logic.ParseTrimStamp(null) == null);
            Check("trim now: due, no game", Logic.TrimNow(true, Game.None("No game."), false));
            Check("no stamp: the newest .old roll is the last trim", Logic.LastTrimOr(null, new[] { now.AddDays(-20), now.AddHours(-3) }) == now.AddHours(-3) && !Logic.TrimDue(Logic.LastTrimOr(null, new[] { now.AddHours(-3) }), now));
            Check("no stamp, no roll: none (trim); a stamp wins over the rolls", Logic.LastTrimOr(null, new DateTime[0]) == null && Logic.LastTrimOr(now, new[] { now.AddDays(1) }) == now);
            Check("trim rolls: companion.log.old yes; bridge-live.log.old, .old alone, table-log no", Logic.IsTrimRoll("companion.log.old") && Logic.IsTrimRoll("TTS-console.log.OLD") && !Logic.IsTrimRoll("bridge-live.log.old") && !Logic.IsTrimRoll(".old") && !Logic.IsTrimRoll("table-log.log"));
            Check("trim waits: game on", !Logic.TrimNow(true, Game.On("Game on", 3), false));
            Check("trim waits: can't tell", !Logic.TrimNow(true, Game.CantTell("slow"), false));
            Check("trim waits: not due, or an observing copy", !Logic.TrimNow(false, Game.None("No game."), false) && !Logic.TrimNow(true, Game.None("No game."), true));

            Check("table-log.log: archived (the real game history)", Logic.TrimKindOf("table-log.log") == TrimKind.Archive && Logic.TrimKindOf("Table-Log.log.trimming") == TrimKind.Archive);
            Check("tts-stream*.jsonl: deleted", Logic.TrimKindOf("tts-stream.jsonl") == TrimKind.Delete && Logic.TrimKindOf("tts-stream-headless.jsonl") == TrimKind.Delete);
            Check("console, game, check, guess and companion logs: rolled",
                new[] { "tts-console.log", "game-log.txt", "table-check.log", "guess-log.log", "companion.log" }.All(n => Logic.TrimKindOf(n) == TrimKind.Roll));
            string[] never = { "bridge.log", "bridge-live.log", "bridge.log.1", "companion.log.1", "tts-console.log.old", "table-log-2026-11-13.log.gz", "bridge-game.json", "log-trim.stamp", "tts-stream.jsonl.bak" };
            var touched = never.Where(n => Logic.TrimKindOf(n).HasValue).ToArray();
            Check("never touched: bridge log (+.1), .old rolls, archives, resume file, stamp", touched.Length == 0, string.Join(",", touched));

            // the plan over a fake folder listing
            var home = Layout.Make(Mode.Home, @"C:\r");
            var dirs = new Dictionary<string, string[]>(StringComparer.OrdinalIgnoreCase);
            dirs[@"C:\r\tmp"] = new[] { @"C:\r\tmp\table-log.log", @"C:\r\tmp\table-log.log.trimming", @"C:\r\tmp\tts-stream.jsonl", @"C:\r\tmp\bridge-live.log", @"C:\r\tmp\companion.log", @"C:\r\tmp\guess-log.log" };
            dirs[@"C:\r\bridge"] = new[] { @"C:\r\bridge\tts-console.log", @"C:\r\bridge\game-log.txt", @"C:\r\bridge\bridge.js" };
            dirs[@"D:\P\logs"] = new[] { @"D:\P\logs\table-log.log", @"D:\P\logs\bridge.log", @"D:\P\logs\tts-console.log" };
            dirs[@"D:\P\bridge"] = new[] { @"D:\P\bridge\tts-console.log" };
            Func<string, string[]> list = d => dirs.ContainsKey(d) ? dirs[d] : new string[0];
            Func<string, long> size = f => f.EndsWith("guess-log.log") ? 0 : 1000;
            var plan = Logic.TrimPlan(home, list, size);
            var names = plan.Select(i => i.Path).ToList();
            Check("home plan: tmp\\ and bridge\\ logs, not the bridge log, bridge.js or an empty file",
                names.Contains(@"C:\r\tmp\table-log.log") && names.Contains(@"C:\r\tmp\tts-stream.jsonl") && names.Contains(@"C:\r\tmp\companion.log")
                && names.Contains(@"C:\r\bridge\tts-console.log") && names.Contains(@"C:\r\bridge\game-log.txt")
                && !names.Contains(@"C:\r\tmp\bridge-live.log") && !names.Contains(@"C:\r\bridge\bridge.js") && !names.Contains(@"C:\r\tmp\guess-log.log") && names.Count == 6,
                string.Join(" | ", names));
            Check("home plan: a leftover .trimming goes before the live table log", names.IndexOf(@"C:\r\tmp\table-log.log.trimming") == 0, string.Join(" | ", names));
            plan = Logic.TrimPlan(Layout.Make(Mode.Friend, @"D:\P"), list, size);
            names = plan.Select(i => i.Path).ToList();
            Check("friend plan: logs\\ only (never the package's bridge\\), never bridge.log",
                names.Count == 2 && names.Contains(@"D:\P\logs\table-log.log") && names.Contains(@"D:\P\logs\tts-console.log"), string.Join(" | ", names));

            var local = new DateTime(2026, 11, 13, 9, 0, 0, DateTimeKind.Local);
            var ap = Logic.ArchivePath(@"C:\r\tmp\table-log.log", local, Files());
            Check("archive: log-archive\\ beside it, dated", ap == @"C:\r\tmp\log-archive\table-log-2026-11-13.log.gz", ap);
            ap = Logic.ArchivePath(@"C:\r\tmp\table-log.log", local, Files(@"C:\r\tmp\log-archive\table-log-2026-11-13.log.gz"));
            Check("archive: a second one the same day gets -2", ap == @"C:\r\tmp\log-archive\table-log-2026-11-13-2.log.gz", ap);
            var line = Logic.TrimSummary(new List<TrimDone> {
                new TrimDone { Name = "table-log.log", Kind = TrimKind.Archive, Before = 14 * 1048576L, After = 1048576L, Freed = 13 * 1048576L },
                new TrimDone { Name = "tts-stream.jsonl", Kind = TrimKind.Delete, Before = 189 * 1048576L, Freed = 189 * 1048576L },
                new TrimDone { Name = "guess-log.log", Kind = TrimKind.Roll, Error = "in use" } });
            Check("summary: one line, freed total, each file, the skipped one named",
                line == "log trim: freed 202.0 MB; table-log.log archived (14.0 MB to 1.0 MB .gz), tts-stream.jsonl deleted (189.0 MB), guess-log.log skipped (in use).", line);
            Check("summary: nothing to trim", Logic.TrimSummary(new List<TrimDone>()) == "log trim: nothing to trim.");

            // the file work on a temp repo (never the real logs)
            var tmp = Path.Combine(Path.GetTempPath(), "mtg-companion-selftest-trim-" + Guid.NewGuid().ToString("N").Substring(0, 6));
            try
            {
                var l = Layout.Make(Mode.Home, tmp);
                Directory.CreateDirectory(l.LogsDir); Directory.CreateDirectory(Path.Combine(tmp, "bridge"));
                var tsb = new StringBuilder();
                for (int i = 0; i < 2000; i++) tsb.Append("[12:" + (i % 60).ToString("00") + ":00] White  cast Lightning Bolt targeting Blue\n");
                string tableText = tsb.ToString();
                File.WriteAllText(Path.Combine(l.LogsDir, "table-log.log"), tableText);
                File.WriteAllText(Path.Combine(l.LogsDir, "tts-stream.jsonl"), "{\"at\":1}\n");
                File.WriteAllText(Path.Combine(l.LogsDir, "tts-stream-headless.jsonl"), "{\"at\":2}\n");
                File.WriteAllText(Path.Combine(l.LogsDir, "table-check.log"), "this roll\n");
                File.WriteAllText(Path.Combine(l.LogsDir, "table-check.log.old"), "the roll before\n");
                File.WriteAllText(Path.Combine(l.LogsDir, "guess-log.log"), "held open\n");
                File.WriteAllText(l.BridgeLog, "bridge says\n");
                File.WriteAllText(l.CompanionLog, "lights\n");
                File.WriteAllText(Path.Combine(tmp, "bridge", "tts-console.log"), "console\n");

                string result;
                using (new FileStream(Path.Combine(l.LogsDir, "guess-log.log"), FileMode.Open, FileAccess.Read, FileShare.None)) // (a file in use)
                    result = LogTrim.Run(l, now);
                var gz = Path.Combine(l.LogsDir, "log-archive", "table-log-" + now.ToLocalTime().ToString("yyyy-MM-dd") + ".log.gz");
                string back = null;
                try { using (var z = new System.IO.Compression.GZipStream(File.OpenRead(gz), System.IO.Compression.CompressionMode.Decompress)) using (var r = new StreamReader(z)) back = r.ReadToEnd(); }
                catch (Exception e) { back = "unreadable: " + e.Message; }
                Check("run: table-log.log archived to log-archive\\, the .gz holds every line", back == tableText, back == null ? null : Logic.Clip(back, 80));
                Check("run: table-log.log started empty, no .trimming left", TrimLen(Path.Combine(l.LogsDir, "table-log.log")) == 0 && !File.Exists(Path.Combine(l.LogsDir, "table-log.log.trimming")));
                Check("run: tts-stream*.jsonl deleted", !File.Exists(Path.Combine(l.LogsDir, "tts-stream.jsonl")) && !File.Exists(Path.Combine(l.LogsDir, "tts-stream-headless.jsonl")));
                Check("run: a rolled log's .old is this roll, the earlier .old replaced", !File.Exists(Path.Combine(l.LogsDir, "table-check.log")) && TrimText(Path.Combine(l.LogsDir, "table-check.log.old")) == "this roll\n");
                Check("run: bridge\\tts-console.log and the companion log rolled", File.Exists(Path.Combine(tmp, "bridge", "tts-console.log.old")) && File.Exists(l.CompanionLog + ".old") && !File.Exists(l.CompanionLog));
                Check("run: the bridge log untouched", TrimText(l.BridgeLog) == "bridge says\n" && !File.Exists(l.BridgeLog + ".old"));
                Check("run: a file in use skipped and named, kept as it was, no throw", result.Contains("guess-log.log skipped") && TrimText(Path.Combine(l.LogsDir, "guess-log.log")) == "held open\n" && !File.Exists(Path.Combine(l.LogsDir, "guess-log.log.old")), result);
                Check("run: the line says what was freed", result.StartsWith("log trim: freed ") && result.Contains("table-log.log archived") && result.Contains("tts-stream.jsonl deleted"), result);
                var last = LogTrim.LastTrim(l);
                Check("run: stamp written, next trim in 14 days", last.HasValue && last.Value == now && !Logic.TrimDue(last, now.AddDays(13)) && Logic.TrimDue(last, now.AddDays(14)), last);
                File.Delete(LogTrim.StampFile(l));
                var noStamp = LogTrim.LastTrim(l);
                Check("stamp deleted: the .old rolls just made say the trim was now, not due", noStamp.HasValue && !Logic.TrimDue(noStamp, DateTime.UtcNow), noStamp);
                File.WriteAllText(LogTrim.StampFile(l), Logic.TrimStampText(now));

                // a .trimming a failed run left, and new lines since: both archived, the leftover first, nothing lost
                File.WriteAllText(Path.Combine(l.LogsDir, "table-log.log.trimming"), "left over\n");
                File.WriteAllText(Path.Combine(l.LogsDir, "table-log.log"), "new lines\n");
                LogTrim.Run(l, now);
                var gz2 = gz.Replace(".log.gz", "-2.log.gz"); var gz3 = gz.Replace(".log.gz", "-3.log.gz");
                Func<string, string> unzip = p => { try { using (var z = new System.IO.Compression.GZipStream(File.OpenRead(p), System.IO.Compression.CompressionMode.Decompress)) using (var r = new StreamReader(z)) return r.ReadToEnd(); } catch { return null; } };
                Check("leftover .trimming: archived first (-2), then the live file (-3)", unzip(gz2) == "left over\n" && unzip(gz3) == "new lines\n" && !File.Exists(Path.Combine(l.LogsDir, "table-log.log.trimming")), unzip(gz2) + " / " + unzip(gz3));
                Check("missing logs folder: nothing to trim, no throw", LogTrim.Run(Layout.Make(Mode.Home, Path.Combine(tmp, "nothing-here")), now).StartsWith("log trim: nothing to trim"));

                // the watcher's hook: the game lock holds it off, no game lets it run
                var pkg = Path.Combine(tmp, "pkg");
                var c = new Controller(Layout.Make(Mode.Friend, pkg), false, Path.Combine(pkg, "saves"), Path.Combine(pkg, "state"), "x.exe");
                Directory.CreateDirectory(c.L.LogsDir);
                File.WriteAllText(Path.Combine(c.L.LogsDir, "tts-console.log"), "console\n");
                c.Game = Game.On("Game on: turn 6, 4 players.", 6);
                c.MaybeTrimLogs();
                Check("watcher: no trim while a game is on", File.Exists(Path.Combine(c.L.LogsDir, "tts-console.log")) && LogTrim.LastTrim(c.L) == null);
                c.Game = Game.None("No game.");
                c.MaybeTrimLogs();
                Check("watcher: due and no game: trims on the next tick", !File.Exists(Path.Combine(c.L.LogsDir, "tts-console.log")) && File.Exists(Path.Combine(c.L.LogsDir, "tts-console.log.old")) && LogTrim.LastTrim(c.L).HasValue);
                var o = new Controller(Layout.Make(Mode.Friend, Path.Combine(tmp, "pkg2")), true, tmp, tmp, "x.exe");
                Directory.CreateDirectory(o.L.LogsDir);
                File.WriteAllText(Path.Combine(o.L.LogsDir, "tts-console.log"), "console\n");
                o.Game = Game.None("No game.");
                o.MaybeTrimLogs();
                Check("watcher: an observing copy never trims", File.Exists(Path.Combine(o.L.LogsDir, "tts-console.log")));
            }
            catch (Exception e) { Check("log trim file work ran to the end", false, e.GetType().Name + ": " + e.Message); }
            finally { try { Directory.Delete(tmp, true); } catch { } }
        }

        // (a missing file reads as -1 / null, so a broken trim fails its check by name instead of ending the self-test)
        static long TrimLen(string f) { try { return File.Exists(f) ? new FileInfo(f).Length : -1; } catch { return -1; } }
        static string TrimText(string f) { try { return File.Exists(f) ? File.ReadAllText(f) : null; } catch { return null; } }

        static void Misc()
        {
            sb.AppendLine("-- misc");
            Check("relay key from stack\\.env", Logic.RelayKey("FOO=1\r\nMANABREW_SERVER_KEY=\"s3cret\"\r\n") == "s3cret");
            Check("relay key default", Logic.RelayKey(null) == "tts-local" && Logic.RelayKey("MANABREW_SERVER_KEY=") == "tts-local");
            Check("light log: a green light whose login ms alone moved: no line", !Logic.LogLightChange(Light.Green, "Ready: room tts-commander is open (login 7 ms).", Light.Green, "Ready: room tts-commander is open (login 164 ms)."));
            Check("light log: new words, a new colour, or a red light's numbers: a line", Logic.LogLightChange(Light.Green, "Running (bridge 12345678).", Light.Green, "Running (bridge 87654321).") && Logic.LogLightChange(Light.Green, "Ready (login 7 ms).", Light.Red, "Ready (login 7 ms).") && Logic.LogLightChange(Light.Red, "waited 3 s", Light.Red, "waited 4 s"));
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
