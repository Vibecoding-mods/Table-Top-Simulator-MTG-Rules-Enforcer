// MTG Companion: one double-click starts the rules-engine table (Docker, the engine images and stack, the table save,
// the bridge, TTS) and shows one status light per step. Design: docs/companion-app-spec.md; friend mode: the package
// folder (version.json beside the exe); home mode: the repo.
//   MTG Companion.exe                      start everything, then watch (tray icon)
//   MTG Companion.exe --observe            only read and show the lights; changes nothing
//       [--home DIR] [--saves DIR] [--state DIR] [--dump FILE]   (--dump: write the lights after one pass and exit)
//       [--no-web] [--web-port N] [--no-browser]   the status page on 127.0.0.1:48790 (WebUi.cs) or the old window
//   MTG Companion.exe --selftest [--out FILE]   the decision logic against canned inputs; exit code = failures
//   MTG Companion.exe --bridge-loop --home DIR  (internal) the hidden loop that runs and restarts the bridge
//   MTG Companion.exe --write-icon FILE         writes the app icon (.ico)
//   MTG Companion.exe --probe-login URL [KEY]   one relay login, printed (for testing against a fake relay)
//   MTG Companion.exe --update-check | --update-now   self-update without the window (docs/companion-app-spec.md §18):
//       [--update-base URL] (a fake GitHub on this PC: http://127.0.0.1:PORT only; then also --test-public-key KEY,
//       --test-die-at move|place|placed, --test-format N) [--fake-effects FILE [--fake-fail STEP,...]] (--update-now needs it)
//       [--bridge-url URL] [--state DIR] [--log FILE]; exit 0 up to date or done, 10 update available, 3 deferred, 1 failed
//   MTG Companion.exe --set-token               the GitHub token from stdin, stored with DPAPI (empty: removed)
//   MTG Companion.exe --replace-old PID PATH --old-start TICKS --part-version V   (internal) the new exe takes over
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("MTG Companion")]
[assembly: AssemblyDescription("Starts and watches the MTG rules-engine table for Tabletop Simulator")]
[assembly: AssemblyProduct("MTG Companion")]
[assembly: AssemblyCompany("Table-Top-Simulator-Mock-MTGA")]
[assembly: AssemblyVersion("1.0.0.0")]
[assembly: AssemblyFileVersion("1.0.0.0")]

namespace MtgCompanion
{
    public static class Program
    {
        [DllImport("kernel32.dll")] static extern bool AttachConsole(int pid);

        public static string Arg(string[] args, string name)
        {
            int i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : null;
        }

        static void Out(string text, string file)
        {
            if (file != null) try { File.WriteAllText(file, text, new UTF8Encoding(false)); } catch { }
            try
            {
                if (Console.IsOutputRedirected)
                {
                    // (a pipe or a file: UTF-8, so "—" and "→" survive; the console's own code page would turn them into "-")
                    var b = new UTF8Encoding(false).GetBytes(text);
                    using (var o = Console.OpenStandardOutput()) o.Write(b, 0, b.Length);
                    return;
                }
                AttachConsole(-1); Console.Out.Write(text); Console.Out.Flush();
            }
            catch { }
        }

        static string Quote(string a) { return a.Length > 0 && a.IndexOfAny(new[] { ' ', '"', '\t' }) < 0 ? a : "\"" + a.Replace("\"", "\\\"") + "\""; }

        // --update-check / --update-now: the self-update without the window (tests drive it against a fake GitHub)
        static int HeadlessUpdate(string[] args, Layout layout, string stateDir, string exe, string recovered)
        {
            string said = recovered != null ? recovered + Environment.NewLine : "";
            Action<string> say = t => { Out(said + t + Environment.NewLine, Arg(args, "--out")); said = ""; };
            if (layout == null || !layout.Friend) { say("Updates: friend mode only (a package folder)."); return 2; }
            Log.File = Arg(args, "--log") ?? layout.CompanionLog;
            if (Arg(args, "--bridge-url") != null) Controller.BridgeUrl = Arg(args, "--bridge-url");
            string testBase = Arg(args, "--update-base");
            if (testBase != null && !Updates.TestBaseOk(testBase)) { say("--update-base takes only http://127.0.0.1 or http://localhost (a fake GitHub on this PC)."); return 2; }
            var upd = new Updater(layout, stateDir, exe, testBase);
            if (testBase != null)
            {
                upd.DieAt = Arg(args, "--test-die-at");
                int f; if (int.TryParse(Arg(args, "--test-format") ?? "", out f)) upd.Format = f;
            }
            UpdateManifest m; UpdatePlan plan; string error;
            string applyTag = Arg(args, "--apply-update");
            if (applyTag != null)
            {
                m = upd.Downloaded(applyTag, out error);
                if (m == null) { say(error); return 1; }
                plan = upd.PlanFor(m);
            }
            else
            {
                var r = upd.Check();
                say(r.Text);
                if (args.Contains("--update-check") || !r.Available) return r.Available ? 10 : r.Failed && !r.Quiet ? 1 : 0;
                m = r.Manifest; plan = r.Plan;
                error = upd.Download(m, plan);
                if (error != null) { say(error); return 1; }
            }
            string fake = Arg(args, "--fake-effects");
            if (fake == null) { say("--update-now installs only with --fake-effects (the app installs updates from its tray menu)."); return 2; }
            var fails = (Arg(args, "--fake-fail") ?? "").Split(',').Where(x => x.Length > 0);
            var fx = new FakeEffects(fake, fails, () =>
            {
                double? age = null;
                foreach (var f in layout.ResumeFiles) try { if (File.Exists(f)) { double a = (DateTime.UtcNow - File.GetLastWriteTimeUtc(f)).TotalSeconds; if (!age.HasValue || a < age.Value) age = a; } } catch { }
                return Logic.Locked(Logic.DecideGame(Probes.HttpGet(Controller.BridgeUrl + "/state", 5000), age));
            });
            // what the new exe runs with: just the swap here, or (companion first) the rest of the release headless too
            var carry = new List<string>();
            foreach (var k in new[] { "--fake-effects", "--fake-fail", "--state", "--update-base", "--test-public-key", "--bridge-url", "--log" }) if (Arg(args, k) != null) { carry.Add(k); carry.Add(Arg(args, k)); }
            string selfArgs = plan.CompanionFirst ? "--update-now " + string.Join(" ", carry.Select(Quote)) : "--then-exit " + string.Join(" ", carry.Select(Quote));
            var res = upd.Apply(m, plan, fx, selfArgs);
            say(res.Text);
            return res.Ok ? 0 : res.Deferred ? 3 : 1;
        }

        [STAThread]
        public static int Main(string[] args)
        {
            string exe = Assembly.GetExecutingAssembly().Location;
            string exeDir = Path.GetDirectoryName(exe);

            if (args.Contains("--selftest"))
            {
                var sb = new StringBuilder();
                int failed = SelfTest.Run(sb);
                Out(sb.ToString(), Arg(args, "--out"));
                return failed;
            }
            if (args.Contains("--write-icon"))
            {
                Icons.WriteIco(Arg(args, "--write-icon"));
                return 0;
            }
            if (args.Contains("--probe-login"))
            {
                var r = Probes.RelayLogin(Arg(args, "--probe-login"), args.Length > 2 ? args[2] : "tts-local", Logic.Room, 3000);
                Out("login: " + r.Kind + ", room " + (r.RoomFound ? r.RoomStatus : "not listed") + ", " + r.Ms + " ms" + (r.Detail != null ? " (" + r.Detail + ")" : "") + Environment.NewLine, Arg(args, "--out"));
                return r.Kind == LoginKind.Ok ? 0 : 1;
            }

            string stateDir = Arg(args, "--state") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "MTG Companion");
            string ub = Arg(args, "--update-base");
            if (Updates.TestBaseOk(ub)) Updater.TestKey = Arg(args, "--test-public-key");
            // an update a kill or a power cut interrupted: finished or undone before the package is read (its
            // version.json may be in the backup). Not in the bridge loop, the swap or --observe (which changes nothing).
            string recovered = null;
            if (!new[] { "--bridge-loop", "--bridge-stop", "--replace-old", "--observe" }.Any(args.Contains))
            {
                string home = Arg(args, "--home") ?? exeDir;
                if (File.Exists(Path.Combine(home, Updates.JournalFile)))
                {
                    Log.File = Arg(args, "--log") ?? Path.Combine(home, "logs", "companion.log");
                    recovered = Updater.Recover(home);
                }
            }
            var layout = Logic.DetectLayout(exeDir, File.Exists, Arg(args, "--home"));
            if (args.Contains("--replace-old"))
            {
                // the new exe (MTG Companion.new.exe): the old one has exited or is exiting
                int i = Array.IndexOf(args, "--replace-old"), pid; long oldStart; long.TryParse(Arg(args, "--old-start") ?? "0", out oldStart);
                if (layout == null || !layout.Friend || i + 2 >= args.Length || !int.TryParse(args[i + 1], out pid)) return 2;
                Log.File = Arg(args, "--log") ?? layout.CompanionLog;
                string oldPath = args[i + 2];
                bool stillRunning;
                var final = Updater.ReplaceOld(pid, oldStart, oldPath, exe, Arg(args, "--part-version"), layout.VersionFile, out stillRunning);
                if (final == null)
                {
                    if (args.Contains("--then-exit")) return 1;
                    if (stillRunning)
                    {
                        MessageBox.Show("The update of MTG Companion itself couldn't finish: the old MTG Companion was still running after a minute.\r\n\r\nRight-click its tray icon, choose Quit, then start MTG Companion again. Everything else of the update is installed.", "MTG Companion", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                        return 1;
                    }
                    if (File.Exists(oldPath)) Process.Start(oldPath, "--after-update").Dispose();
                    return 1;
                }
                if (args.Contains("--then-exit")) return 0;
                var rest = new List<string>();
                for (int k = 0; k < args.Length; k++)
                {
                    if (k == i) { k += 2; continue; }
                    if (args[k] == "--part-version" || args[k] == "--old-start") { k++; continue; }
                    rest.Add(args[k]);
                }
                rest.Add("--after-update"); // (not a clean start: the old exe stays until the next one)
                Process.Start(new ProcessStartInfo(final, string.Join(" ", rest.Select(Quote))) { UseShellExecute = false, WorkingDirectory = exeDir }).Dispose();
                return 0;
            }
            if (layout != null && layout.Friend && !args.Contains("--after-update") && !args.Contains("--bridge-loop") && !args.Contains("--bridge-stop"))
                Updater.CleanAfterSwap(exe);
            if (args.Contains("--set-token"))
            {
                string t = Console.In.ReadToEnd();
                TokenStore.Save(stateDir, t);
                Out((string.IsNullOrWhiteSpace(t) ? "token removed" : "token saved (encrypted for this Windows user)") + Environment.NewLine, Arg(args, "--out"));
                return 0;
            }
            if (args.Contains("--update-check") || args.Contains("--update-now"))
                return HeadlessUpdate(args, layout, stateDir, exe, recovered);
            if (args.Contains("--bridge-loop"))
            {
                if (layout == null || !layout.Friend) return 2;
                return BridgeLoop.Run(layout);
            }
            if (args.Contains("--bridge-stop"))
            {
                // stops this package's bridge loop and bridge, nothing else (friend mode only)
                if (layout == null || !layout.Friend) return 2;
                BridgeLoop.SignalStop();
                Probes.Kill(Probes.FindProcesses(Path.GetFileName(exe), "--bridge-loop", layout.Home));
                Probes.Kill(Probes.FindProcesses("node.exe", layout.BridgeJs));
                return 0;
            }

            bool observe = args.Contains("--observe");
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (layout == null)
            {
                string msg = "MTG Companion can't find its files.\r\n\r\nIt looks for version.json beside the exe (the package), or for the repo (bridge\\bridge.js and Start MTG.bat) above it.\r\n\r\nThis exe is in:\r\n" + exeDir + "\r\n\r\nUnzip the whole package and run it from there.";
                if (args.Contains("--dump")) { Out(msg + Environment.NewLine, Arg(args, "--dump")); return 3; }
                MessageBox.Show(msg, "MTG Companion", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 3;
            }

            string savesDir = Arg(args, "--saves") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "My Games", "Tabletop Simulator", "Saves");
            Log.File = Arg(args, "--log") ?? layout.CompanionLog;

            Mutex mutex = null;
            EventWaitHandle show = null;
            if (!observe)
            {
                bool first;
                mutex = new Mutex(true, @"Local\MtgTtsCompanion", out first);
                show = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\MtgTtsCompanionShow");
                if (!first) { show.Set(); return 0; } // (the running one shows its window)
            }

            Controller.UpdateBase = Updates.TestBaseOk(ub) ? ub : null;
            var c = new Controller(layout, observe, savesDir, stateDir, exe);
            c.Recovered = recovered;
            c.ApplyAfterSwap = Arg(args, "--apply-update");
            if (Arg(args, "--bridge-url") != null) Controller.BridgeUrl = Arg(args, "--bridge-url");
            string steps = Arg(args, "--steps");
            if (steps != null) c.OnlySteps = new HashSet<int>(steps.Split(',').Select(x => { int n; return int.TryParse(x.Trim(), out n) ? n : 0; }));
            string dump = Arg(args, "--dump");
            if (dump != null)
            {
                // headless: one pass of every check, written out, then exit
                c.Start();
                var until = DateTime.UtcNow.AddSeconds(120);
                while (!c.FirstPassDone && DateTime.UtcNow < until) Thread.Sleep(200);
                Out(c.Dump(), dump);
                c.Quit();
                return 0;
            }

            var form = new StatusForm(c, show);
            var web = WebUi.Launch(c, form, args); // the status page in the browser; null: this window as before (WebUi.cs)
            string shot = Arg(args, "--shot");
            if (shot != null && observe)
            {
                // the window draws itself to a PNG after the first pass, then the app exits (for tests and docs)
                var t = new System.Windows.Forms.Timer { Interval = 500 };
                var t0 = DateTime.UtcNow;
                t.Tick += (s, e) =>
                {
                    if (!c.FirstPassDone && (DateTime.UtcNow - t0).TotalSeconds < 120) return;
                    t.Stop();
                    form.Refresh();
                    using (var bmp = new System.Drawing.Bitmap(form.Width, form.Height))
                    {
                        form.DrawToBitmap(bmp, new System.Drawing.Rectangle(0, 0, form.Width, form.Height));
                        bmp.Save(shot, System.Drawing.Imaging.ImageFormat.Png);
                    }
                    File.WriteAllText(Path.ChangeExtension(shot, ".txt"), c.Dump(), new UTF8Encoding(false));
                    form.ForceExit();
                };
                t.Start();
            }
            c.Start();
            if (web != null) Application.Run(); else Application.Run(form); // (the page: the window stays hidden, tray only)
            c.Quit();
            if (web != null) web.Stop();
            if (mutex != null) { try { mutex.ReleaseMutex(); } catch { } }
            return 0;
        }
    }

    // The hidden process that runs the bridge and restarts it 3 s after any exit (replaces tools\start-bridge.ps1 in
    // friend mode). It is its own process, so closing or updating the app never touches a game. Node writes straight to
    // logs\bridge.log through cmd's redirection; stop: the named event, then the processes by command line.
    public static class BridgeLoop
    {
        const string StopName = @"Local\MtgTtsCompanionBridgeStop";

        public static void SignalStop()
        {
            try { EventWaitHandle h; if (EventWaitHandle.TryOpenExisting(StopName, out h)) using (h) h.Set(); } catch { }
            Thread.Sleep(1500);
        }

        static void Line(string log, string text)
        {
            for (int i = 0; i < 5; i++)
            {
                try { File.AppendAllText(log, text + Environment.NewLine, new UTF8Encoding(false)); return; }
                catch { Thread.Sleep(300); } // (the bridge's cmd may still hold the file for a moment)
            }
        }

        public static int Run(Layout l)
        {
            bool first;
            using (var mutex = new Mutex(true, @"Local\MtgTtsCompanionBridgeLoop", out first))
            using (var stop = new EventWaitHandle(false, EventResetMode.ManualReset, StopName))
            {
                if (!first) return 0; // one loop at a time
                stop.Reset();
                Directory.CreateDirectory(l.LogsDir);
                var reports = Path.Combine(l.LogsDir, "node-reports");
                while (true)
                {
                    try
                    {
                        var fi = new FileInfo(l.BridgeLog);
                        if (fi.Exists && fi.Length > 20L * 1024 * 1024)
                        {
                            var old = l.BridgeLog + ".1";
                            if (File.Exists(old)) File.Delete(old);
                            File.Move(l.BridgeLog, old);
                        }
                    }
                    catch { }
                    Line(l.BridgeLog, "[companion: starting the bridge at " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "]");
                    string inner = "\"" + l.NodeExe + "\" --report-on-fatalerror --report-uncaught-exception --report-directory=\"" + reports + "\" \"" + l.BridgeJs + "\" >> \"" + l.BridgeLog + "\" 2>&1";
                    var psi = new ProcessStartInfo("cmd.exe", "/d /s /c \"" + inner + "\"") { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(l.BridgeJs) };
                    psi.EnvironmentVariables["MTG_HOME"] = l.Home;
                    psi.EnvironmentVariables["MTG_LOG_DIR"] = l.LogsDir; // (its logs and resume file in logs\, as README-FRIEND says)
                    int code = -1;
                    try
                    {
                        using (var p = Process.Start(psi))
                        {
                            while (!p.WaitForExit(1000))
                                if (stop.WaitOne(0))
                                {
                                    Probes.Kill(Probes.FindProcesses("node.exe", l.BridgeJs));
                                    try { p.Kill(); } catch { }
                                    p.WaitForExit(3000); // (cmd's redirect holds the log until it is gone)
                                    Line(l.BridgeLog, "[companion: bridge stopped at " + DateTime.Now.ToString("HH:mm:ss") + "]");
                                    return 0;
                                }
                            code = p.ExitCode;
                        }
                    }
                    catch (Exception e) { Line(l.BridgeLog, "[companion: couldn't start node: " + e.Message + "]"); }
                    Line(l.BridgeLog, "[bridge exited with code " + code + " at " + DateTime.Now.ToString("HH:mm:ss") + "; restarting in 3 s]");
                    if (stop.WaitOne(3000)) return 0;
                }
            }
        }
    }
}
