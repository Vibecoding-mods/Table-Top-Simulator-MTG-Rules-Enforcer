// The start sequence (6 steps, one light each), the watcher that keeps the lights current afterwards, and the actions
// behind the fix buttons and the tray menu. Everything runs on one worker thread, so two actions never overlap.
// Nothing that restarts or changes the engine runs while a game is on, or while the app can't tell (Logic.Locked).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;

namespace MtgCompanion
{
    public class Row
    {
        public string Name; public Verdict V; public DateTime At;
        public Row(string n) { Name = n; V = new Verdict(Light.Grey, "Not checked yet."); }
    }

    public static class Log
    {
        static readonly object gate = new object();
        public static string File;
        public static void Write(string line)
        {
            if (File == null) return;
            lock (gate)
            {
                try
                {
                    var fi = new FileInfo(File);
                    if (fi.Exists && fi.Length > 5 * 1024 * 1024)
                    {
                        var old = File + ".1";
                        if (System.IO.File.Exists(old)) System.IO.File.Delete(old);
                        System.IO.File.Move(File, old);
                    }
                    Directory.CreateDirectory(Path.GetDirectoryName(File));
                    System.IO.File.AppendAllText(File, "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + line + Environment.NewLine, new UTF8Encoding(false));
                }
                catch { }
            }
        }
    }

    public partial class Controller
    {
        public const int StepDocker = 0, StepImages = 1, StepStack = 2, StepSave = 3, StepBridge = 4, StepTts = 5;
        public static readonly string[] Names = { "Docker", "Engine images", "Engine stack", "Table save", "Bridge", "TTS" };
        public static string BridgeUrl = "http://127.0.0.1:48787"; // (--bridge-url: tests point it at a fake)

        public readonly Layout L;
        public readonly bool Observe;
        public readonly string SavesDir, StateDir, ExePath;
        public readonly Row[] Rows = Names.Select(n => new Row(n)).ToArray();
        public Game Game = Game.CantTell("Not checked yet.");
        public string Phase = "Starting";
        public string VersionText = "";
        public event Action Changed;
        public event Action<string, string> Notify; // (title, text) for a light that turned red
        public bool FirstPassDone;
        public volatile bool WindowVisible = true;
        public HashSet<int> OnlySteps; // (--steps: run only these start steps, for tests)

        readonly object q = new object();
        readonly Queue<Action> work = new Queue<Action>();
        readonly AutoResetEvent wake = new AutoResetEvent(false);
        Thread thread;
        volatile bool quit, cancel;
        int pendingFrom = 1, resumeFrom; // (resumeFrom: the step a button press interrupted)
        int stoppedAt; // the step the start sequence last stopped at on a red light; 0 when it ran to the end
        const int StackWaitSeconds = 300;
        readonly Dictionary<int, DateTime> busyLogged = new Dictionary<int, DateTime>();
        bool forceFresh, forceLoad, stopped, ttsLaunched;
        object version, deployed;
        string dockerCli, dockerDesktop, saveName, relayKey;
        bool dockerViaCli; DateTime lastCliInfo = DateTime.MinValue; bool lastCliOk;
        HttpResult versionsCache; DateTime versionsAt = DateTime.MinValue, loginAt = DateTime.MinValue, imagesAt = DateTime.MinValue;
        LoginResult loginCache;
        readonly Dictionary<int, DateTime> notified = new Dictionary<int, DateTime>();

        // self-update (friend mode, docs/companion-app-spec.md §18)
        public static string UpdateBase; // (--update-base: tests point it at a fake GitHub)
        public string ApplyAfterSwap; // (--apply-update <tag>: the rest of a release the previous app couldn't apply)
        readonly object updGate = new object();
        UpdateState updState = new UpdateState();
        CheckResult offer; // (the release Update now installs)
        public event Action<CheckResult> UpdateOffered;
        public event Action ExitForUpdate; // the new companion takes over: close without stopping anything
        Updater upd;
        volatile bool updateBusy;
        UpdateManifest pendingM; UpdatePlan pendingPlan; // (downloaded, waiting for the game to end; in updates.json as "pending")
        DateTime? idleSince; // (no game since then: a waiting update installs 2 minutes after the game)
        public string Recovered; // (Updater.Recover's sentence at this start, or null)
        volatile bool applying;
        public bool Applying { get { return applying; } } // files are moving: Quit and shutdown wait
        public event Action ApplyingChanged;

        public Controller(Layout l, bool observe, string savesDir, string stateDir, string exePath)
        {
            L = l; Observe = observe; SavesDir = savesDir; StateDir = stateDir; ExePath = exePath;
            ReloadPackage();
            if (!L.Friend) Rows[StepSave].V = new Verdict(Light.Grey, "Home mode: you keep your own save (" + saveName + ").");
            if (L.Friend && !Observe)
            {
                upd = new Updater(L, StateDir, ExePath, UpdateBase);
                upd.Progress = (text, percent) => SetUpdate(s => { s.Status = "downloading"; s.Progress = percent; s.Text = text; });
                var st = upd.State();
                SetUpdate(s => { s.Text = J.Str(st, "lastResult") ?? ""; s.LastCheck = J.Str(st, "lastCheck"); });
                var waiting = J.Str(st, "pending");
                if (waiting != null)
                {
                    // an update that waited for a game when the app last ran: it still waits (and installs after the game)
                    string error;
                    var m = upd.Downloaded(waiting, out error);
                    var plan = m == null ? null : upd.PlanFor(m);
                    if (plan != null && plan.Refused == null && !plan.UpToDate)
                    {
                        pendingM = m; pendingPlan = plan;
                        SetUpdate(s => { s.Status = "ready"; s.Available = m.Version; s.DeferredUntilGameEnds = true; s.Text = "Update " + m.Version + " ready — will install after the game."; });
                    }
                    else upd.Remember("pending", null);
                }
            }
        }

        // the package's files: at start, and again after an update replaced them
        void ReloadPackage()
        {
            version = L.Friend ? J.Parse(Probes.ReadText(L.VersionFile)) : null;
            deployed = J.Parse(Probes.ReadText(L.DeployedFile));
            relayKey = Logic.RelayKey(Probes.ReadText(L.EnvFile));
            saveName = L.Friend ? (Logic.ReadSaveName(ReadHead(L.TableJson)) ?? Logic.DefaultSaveName) : "Mock MTGA 4 player";
            if (L.Friend) L.ImagesTar = Logic.FindImagesTar(L.Home, File.Exists, d => Directory.Exists(d) ? Directory.GetFiles(d) : new string[0]);
            if (version != null)
                VersionText = "Package " + (J.Str(version, "release") ?? "built " + (J.Str(version, "built") ?? "?")) + ", commit " + (J.Str(version, "gitCommit") ?? "?") + ", table " + (J.Str(version, "table") ?? "?") + ", bridge " + (J.Str(version, "bridge") ?? "?");
            else if (deployed != null)
                VersionText = "Home mode, deployed table " + (J.Str(deployed, "table") ?? "?") + ", bridge " + (J.Str(deployed, "bridge") ?? "?");
        }

        // ── the update's state: one snapshot, changed only here
        public UpdateState Update { get { lock (updGate) return updState.Copy(); } }
        public string UpdateLine { get { return Update.Text; } }
        void SetUpdate(Action<UpdateState> change)
        {
            lock (updGate) { change(updState); updState.Current = VersionShort; }
            Fire();
        }

        // the tray's version line
        public string VersionShort
        {
            get
            {
                if (version == null) return L.Friend ? "Package version unknown" : "Home mode";
                var b = J.Str(version, "built");
                return "Version " + (J.Str(version, "release") ?? "built " + (b != null && b.Length >= 10 ? b.Substring(0, 10) : "?"));
            }
        }

        static string ReadHead(string file)
        {
            try { using (var r = new StreamReader(file, Encoding.UTF8)) { var b = new char[8192]; int n = r.Read(b, 0, b.Length); return new string(b, 0, n); } }
            catch { return null; }
        }

        public string SaveName { get { return saveName; } }
        public string Want(string key) { return J.Str(L.Friend ? version : deployed, key); }

        // ───────────────────────────── the worker ─────────────────────────────

        public void Start()
        {
            dockerCli = Probes.FindDockerCli();
            dockerDesktop = Probes.FindDockerDesktop();
            Log.Write("start: " + L.Mode + " mode, home " + L.Home + (Observe ? " (observe only: no changes)" : "") + "; docker " + (dockerCli ?? "not found") + "; Docker Desktop " + (dockerDesktop ?? "not found"));
            if (L.Friend) Log.Write("package: " + J.Write(version));
            thread = new Thread(Loop);
            thread.IsBackground = true;
            thread.Name = "companion worker";
            thread.Start();
            if (Recovered != null) { var rec = Recovered; SetUpdate(s => { s.Status = "interrupted"; s.Text = rec; }); }
            if (upd != null)
            {
                var after = ApplyAfterSwap;
                var t = new Thread(() =>
                {
                    while (!FirstPassDone && !quit) Thread.Sleep(500);
                    if (quit) return;
                    if (after != null)
                    {
                        string error;
                        var m = upd.Downloaded(after, out error);
                        if (m == null) SetUpdate(s => { s.Status = "failed"; s.Error = s.Text = "The rest of update " + after + " wasn't found (" + error + ")."; });
                        else Enqueue(() => ApplyUpdate(m, upd.PlanFor(m)));
                    }
                    else if (upd.CheckDue() && pendingM == null) CheckForUpdates(false);
                });
                t.IsBackground = true;
                t.Start();
            }
        }

        // ───────────────────────────── self-update ─────────────────────────────

        // the menu's and the page's actions: null when accepted, else why not (the page shows it)
        public bool UpdateBusy { get { return updateBusy || applying; } }
        public string CheckNow()
        {
            if (upd == null)
            {
                var why = Observe ? "Observe mode: no updates." : "Home mode: the repo updates with git, not here.";
                SetUpdate(s => { s.Text = why; }); // (the tray's line, as before)
                return why;
            }
            if (UpdateBusy) return "An update is already being checked, downloaded or installed.";
            CheckForUpdates(true);
            return null;
        }
        public string UpdateNow()
        {
            CheckResult r; lock (updGate) r = offer;
            if (upd == null) return CheckNow();
            if (UpdateBusy) return "An update is already being checked, downloaded or installed.";
            if (r == null || !r.Available) return "No update to install: check for updates first.";
            UpdateNow(r);
            return null;
        }
        public string Later()
        {
            string tag = null;
            lock (updGate) { if (offer != null) tag = offer.Manifest.Version; }
            if (tag == null) return "No update is offered.";
            Log.Write("update " + tag + ": Later");
            SetUpdate(s => { s.Later = true; s.Text = "Update " + tag + " available (Later: Check for updates installs it)."; });
            return null;
        }

        // a check on its own thread; an update found is offered (UpdateOffered) once per release unless asked, never
        // installed unasked
        void CheckForUpdates(bool manual)
        {
            if (upd == null) { SetUpdate(s => { s.Text = L.Friend ? "Observe mode: no updates." : "Home mode: the repo updates with git, not here."; }); return; }
            if (updateBusy) return;
            updateBusy = true;
            SetUpdate(s => { s.Status = "checking"; s.Error = null; if (manual) s.Text = "Checking for updates…"; });
            var t = new Thread(() =>
            {
                try
                {
                    var r = upd.Check();
                    bool again;
                    lock (updGate) again = updState.Later && updState.Available == (r.Manifest != null ? r.Manifest.Version : null);
                    lock (updGate) offer = Updates.OfferAfterCheck(r);
                    SetUpdate(s => s.Checked(r, again, DateTime.UtcNow));
                    if (r.Available && (manual || !again)) { var h = UpdateOffered; if (h != null) h(r); }
                }
                catch (Exception e) { Log.Write("update check failed: " + e); SetUpdate(s => { s.Status = "failed"; s.Error = s.Text = "Couldn't check for updates (" + e.Message + ")."; }); }
                finally { updateBusy = false; }
            });
            t.IsBackground = true;
            t.Start();
        }

        // Update now: download (its own thread), then apply on the worker
        void UpdateNow(CheckResult r)
        {
            if (upd == null || r == null || !r.Available || updateBusy) return;
            updateBusy = true;
            SetUpdate(s => { s.Status = "downloading"; s.Progress = 0; s.Later = false; s.Error = null; s.Text = "Downloading " + r.Manifest.Version + "…"; });
            var t = new Thread(() =>
            {
                try
                {
                    var error = upd.Download(r.Manifest, r.Plan);
                    if (error != null) { Log.Write("update download: " + error); SetUpdate(s => { s.Status = "failed"; s.Progress = -1; s.Error = s.Text = error; }); updateBusy = false; return; }
                    SetUpdate(s => { s.Status = "installing"; s.Progress = -1; s.Text = "Downloaded " + r.Manifest.Version + "; installing."; });
                    Enqueue(() => ApplyUpdate(r.Manifest, r.Plan)); // (busy until ApplyUpdate ends)
                }
                catch (Exception e) { Log.Write("update download failed: " + e); SetUpdate(s => { s.Status = "failed"; s.Progress = -1; s.Error = s.Text = "The download failed (" + e.Message + ")."; }); updateBusy = false; }
            });
            t.IsBackground = true;
            t.Start();
        }

        // on the worker
        void ApplyUpdate(UpdateManifest m, UpdatePlan plan)
        {
            updateBusy = true;
            pendingM = null; pendingPlan = null;
            var was = Phase;
            SetPhase("Updating to " + m.Version);
            SetUpdate(s => { s.Status = "installing"; s.DeferredUntilGameEnds = false; });
            ApplyResult res;
            SetApplying(true);
            try { res = upd.Apply(m, plan, new Effects(this), ""); }
            catch (Exception e) { Log.Write("update apply: " + e); res = new ApplyResult { Text = "The update failed (" + e.Message + ")." }; }
            finally { SetApplying(false); updateBusy = false; } // (before ExitForUpdate: the window may close then)
            Log.Write("update: " + res.Text);
            lock (updGate) offer = Updates.OfferAfterApply(offer, res);
            SetUpdate(s => s.Applied(res));
            if (res.Deferred) { pendingM = m; pendingPlan = plan; SetPhase(was); return; }
            if (res.Swapping) { var h = ExitForUpdate; if (h != null) h(); return; }
            pendingFrom = 1; // (the lights again, from the package as it is now)
        }

        void SetApplying(bool on) { applying = on; var h = ApplyingChanged; if (h != null) try { h(); } catch { } }

        // what an update does to the bridge, Docker and the save: this app's own steps
        class Effects : IUpdateEffects
        {
            readonly Controller c;
            public Effects(Controller c) { this.c = c; }
            public bool Locked() { c.RefreshGame(); return c.IsLocked; }
            public void StopBridge() { c.StopBridge(); }
            public void Reload() { c.ReloadPackage(); }
            public bool LoadImages()
            {
                if (c.L.ImagesTar == null || !c.LoadImages()) return false;
                string e1, e2;
                var relay = c.ImageId(Logic.RelayImage, out e1); var node = c.ImageId(Logic.NodeImage, out e2);
                if (relay != null && node != null) { c.RememberImages(relay, node); c.RewriteDeployed(relay, node); }
                return c.DoStack(true);
            }
            public bool InstallSave() { return c.DoSave(); }
            public bool StartBridge() { return c.DoBridge(); }
        }

        public void Quit()
        {
            // an install in progress finishes first (stopping it halfway is what the journal is for, not the plan)
            var until = DateTime.UtcNow.AddMinutes(15);
            while (applying && DateTime.UtcNow < until) Thread.Sleep(200);
            quit = true; cancel = true; wake.Set(); if (thread != null) thread.Join(3000);
        }

        void Enqueue(Action a) { lock (q) work.Enqueue(a); cancel = true; wake.Set(); }

        void Loop()
        {
            while (!quit)
            {
                Action a = null;
                lock (q) if (work.Count > 0) a = work.Dequeue();
                if (a != null)
                {
                    cancel = false;
                    Safe(a, "action");
                    // a press that interrupted the start sequence: carry on from that step, unless the press restarted or stopped it
                    if (pendingFrom == 0 && resumeFrom > 0 && !stopped) pendingFrom = resumeFrom;
                    resumeFrom = 0;
                    continue;
                }
                if (pendingFrom > 0)
                {
                    int from = Logic.StartFrom(pendingFrom, stoppedAt, StepGreen(stoppedAt)); pendingFrom = 0; cancel = false;
                    Safe(() => RunSequence(from), "start sequence");
                    FirstPassDone = true;
                    Fire();
                    continue;
                }
                if (!stopped) Safe(MonitorTick, "watch");
                FirstPassDone = true;
                wake.WaitOne(WindowVisible ? 5000 : 15000);
            }
        }

        void Safe(Action a, string what)
        {
            try { a(); }
            catch (Exception e) { Log.Write(what + " failed: " + e); }
        }

        // waits, but wakes for a new action or quit; false when the wait was cut short
        bool Pause(int ms)
        {
            var until = DateTime.UtcNow.AddMilliseconds(ms);
            while (DateTime.UtcNow < until)
            {
                if (quit || cancel) return false;
                Thread.Sleep(200);
            }
            return !(quit || cancel);
        }

        bool StepGreen(int step) { return step > 0 && step <= 6 && Rows[step - 1].V != null && Rows[step - 1].V.Light == Light.Green; }

        void Fire() { var c = Changed; if (c != null) try { c(); } catch { } }

        void Set(int i, Verdict v)
        {
            var row = Rows[i];
            bool changed = row.V == null || row.V.Light != v.Light || row.V.Text != v.Text || row.V.Fix != v.Fix;
            row.V = v; row.At = DateTime.Now;
            if (changed)
            {
                // (a progress line every second would flood the log: busy text changes go in at most every 15 s)
                DateTime lastBusy;
                bool progress = v.Light == Light.Busy && busyLogged.TryGetValue(i, out lastBusy) && (DateTime.Now - lastBusy).TotalSeconds < 15;
                if (!progress) { Log.Write("light " + row.Name + ": " + v); if (v.Light == Light.Busy) busyLogged[i] = DateTime.Now; else busyLogged.Remove(i); }
                if (v.Light == Light.Red && !Observe)
                {
                    DateTime last;
                    if (!notified.TryGetValue(i, out last) || (DateTime.Now - last).TotalMinutes > 10)
                    {
                        notified[i] = DateTime.Now;
                        var n = Notify; if (n != null) try { n("MTG: " + row.Name, v.Text); } catch { }
                    }
                }
                Fire();
            }
        }

        void SetPhase(string p) { if (Phase != p) { Phase = p; Log.Write("phase: " + p); Fire(); } }

        // ───────────────────────────── game lock ─────────────────────────────

        void RefreshGame()
        {
            var st = Probes.HttpGet(BridgeUrl + "/state", 5000);
            double? age = null;
            foreach (var f in L.ResumeFiles)
            {
                try
                {
                    if (!File.Exists(f)) continue;
                    double a = (DateTime.UtcNow - File.GetLastWriteTimeUtc(f)).TotalSeconds;
                    if (!age.HasValue || a < age.Value) age = a;
                }
                catch { }
            }
            var g = Logic.DecideGame(st, age);
            bool changed = Game == null || Game.Kind != g.Kind || Game.Text != g.Text;
            Game = g;
            if (Logic.Locked(g)) idleSince = null; else if (!idleSince.HasValue) idleSince = DateTime.UtcNow;
            if (changed) { Log.Write("game: " + g.Kind + ": " + g.Text); Fire(); }
        }

        public bool IsLocked { get { return Logic.Locked(Game); } }

        // ───────────────────────────── the start sequence ─────────────────────────────

        void RunSequence(int from)
        {
            stopped = false; stoppedAt = 0;
            bool fresh = forceFresh; forceFresh = false;
            for (int step = from; step <= 6 && !quit; step++)
            {
                if (OnlySteps != null && !OnlySteps.Contains(step)) { Rows[step - 1].V = new Verdict(Light.Grey, "Skipped (--steps)."); continue; }
                SetPhase(Observe ? "Checking (observe only)" : "Starting: step " + step + " of 6");
                bool ok;
                switch (step - 1)
                {
                    case StepDocker: ok = DoDocker(); break;
                    case StepImages: ok = DoImages(); break;
                    case StepStack: ok = DoStack(fresh); break;
                    case StepSave: ok = DoSave(); break;
                    case StepBridge: ok = DoBridge(); break;
                    default: ok = DoTts(); break;
                }
                if (cancel && !quit) { resumeFrom = step; SetPhase("Interrupted"); return; }
                if (!ok && !Observe)
                {
                    stoppedAt = step;
                    SetPhase("Stopped at step " + step + " (" + Names[step - 1] + "): see the red light");
                    for (int k = step; k < 6; k++) Rows[k].V = new Verdict(Light.Grey, "Waiting for " + Names[step - 1] + ".");
                    if (!L.Friend) Rows[StepSave].V = new Verdict(Light.Grey, "Home mode: you keep your own save (" + saveName + ").");
                    Fire();
                    return;
                }
            }
            SetPhase(Observe ? "Observing (no changes)" : "Ready");
        }

        // ── 1. Docker

        bool DockerAnswers(DockerFacts f)
        {
            var r = Probes.DockerGet("/info", 10000);
            if (r != null && r.Kind == HttpKind.Ok && r.Status == 200)
            {
                var o = J.Parse(r.Body);
                f.Answers = true; f.OsType = J.Str(o, "OSType"); f.Version = J.Str(o, "ServerVersion"); f.Cpus = J.Int(o, "NCPU");
                dockerViaCli = false;
                return true;
            }
            // no engine pipe: the CLI may still reach an engine through another context (at most every 30 s)
            if (dockerCli != null && (DateTime.UtcNow - lastCliInfo).TotalSeconds > 30)
            {
                lastCliInfo = DateTime.UtcNow;
                var c = Probes.Run(dockerCli, "info --format \"{{.ServerVersion}}|{{.OSType}}|{{.NCPU}}\"", 20000, null, null, null, null);
                lastCliOk = c.Exit == 0;
                if (lastCliOk)
                {
                    var p = c.Output.Trim().Split('|');
                    f.Version = p[0]; f.OsType = p.Length > 1 ? p[1] : null; int n; if (p.Length > 2 && int.TryParse(p[2], out n)) f.Cpus = n;
                    Log.Write("docker: the engine pipe didn't answer but the CLI did; using the CLI for reads");
                }
                dockerViaCli = lastCliOk;
            }
            f.Answers = dockerViaCli;
            return f.Answers;
        }

        DockerFacts DockerNow()
        {
            var f = new DockerFacts { CliFound = dockerCli != null, DesktopFound = dockerDesktop != null };
            DockerAnswers(f);
            f.AccessDenied = !f.Answers && Probes.PipeDenied;
            f.DesktopRunning = Probes.ProcessRunning("Docker Desktop");
            return f;
        }

        bool DoDocker()
        {
            DateTime? waitStart = null;
            while (!quit)
            {
                var f = DockerNow();
                f.Waiting = waitStart.HasValue;
                f.WaitedSec = waitStart.HasValue ? (DateTime.UtcNow - waitStart.Value).TotalSeconds : 0;
                var v = Logic.DecideDocker(f);
                if (Observe && v.Action != null) v = new Verdict(Light.Red, f.DesktopRunning ? "Docker Desktop runs, but its engine isn't answering." : "Docker isn't running (the app would start Docker Desktop).");
                Set(StepDocker, v);
                if (v.Light == Light.Green) return true;
                if (v.Light == Light.Red || Observe) return false;
                if (v.Action == Actions.StartDesktop && !waitStart.HasValue) { StartDockerDesktop(); waitStart = DateTime.UtcNow; }
                else if (!waitStart.HasValue) waitStart = DateTime.UtcNow;
                if (!Pause(3000)) return false;
            }
            return false;
        }

        void StartDockerDesktop()
        {
            if (dockerDesktop == null) return;
            Log.Write("starting Docker Desktop: " + dockerDesktop);
            try { Process.Start(new ProcessStartInfo(dockerDesktop) { UseShellExecute = true }); }
            catch (Exception e) { Log.Write("Docker Desktop didn't start: " + e.Message); }
        }

        // ── 2. Engine images

        string ImageId(string tag, out string error)
        {
            if (!dockerViaCli) return Probes.ImageId(tag, out error);
            error = null;
            var r = Probes.Run(dockerCli, "image inspect --format \"{{.Id}}\" " + tag, 20000, null, null, null, null);
            if (r.Exit == 0) return r.Output.Trim();
            if (r.Output.IndexOf("No such image", StringComparison.OrdinalIgnoreCase) >= 0) return null;
            error = r.TimedOut ? "docker didn't answer" : Logic.Clip(r.Output.Trim(), 200);
            return null;
        }

        bool DoImages()
        {
            if (!Rows[StepDocker].V.Light.Equals(Light.Green)) { Set(StepImages, new Verdict(Light.Grey, "Waiting for Docker.")); return Observe; }
            bool loaded = false;
            for (int round = 0; round < 3 && !quit; round++)
            {
                string e1, e2;
                var relay = ImageId(Logic.RelayImage, out e1);
                var node = ImageId(Logic.NodeImage, out e2);
                if (e1 != null || e2 != null)
                {
                    Set(StepImages, new Verdict(Light.Red, "Can't read the engine images: " + (e1 ?? e2) + ".").WithFix(Fixes.Retry, "Try again"));
                    return false;
                }
                RefreshGame();
                string wantRelay = Want("relay"), wantNode = Want("node");
                if (L.Friend) ExpectedImages(out wantRelay, out wantNode);
                if (loaded && relay != null && node != null)
                {
                    // (after a load, the ids are whatever this Docker gives the package's images: remember them)
                    if (!Logic.SameId(relay, wantRelay) || !Logic.SameId(node, wantNode)) Log.Write("after the load Docker reports " + ImageDiff(relay, node) + ": remembered as this package's images");
                    RememberImages(relay, node);
                    if (L.Friend) RewriteDeployed(relay, node);
                    wantRelay = relay; wantNode = node;
                }
                var f = new ImageFacts
                {
                    Friend = L.Friend, RelayId = relay, NodeId = node, WantRelay = wantRelay, WantNode = wantNode,
                    TarPath = L.ImagesTar, LoadedAlready = loaded, Locked = IsLocked,
                };
                if (forceLoad && L.Friend && !loaded && L.ImagesTar != null && !IsLocked) f.RelayId = null; // (the fix button: load again)
                forceLoad = false;
                var v = Logic.DecideImages(f);
                imagesAt = DateTime.UtcNow;
                if (v.Action == Actions.Load && !Observe)
                {
                    Set(StepImages, v);
                    if (!LoadImages())
                    {
                        Set(StepImages, new Verdict(Light.Red, "Loading the engine images didn't work. The log (Open logs folder, companion.log) has Docker's message.").WithFix(Fixes.ImagesLoad, "Load the engine again"));
                        return false;
                    }
                    loaded = true;
                    continue;
                }
                if (Observe && v.Action == Actions.Load) v = new Verdict(Light.Amber, "Would load the engine images from " + Path.GetFileName(L.ImagesTar) + " (" + ImageDiff(relay, node) + ").");
                Set(StepImages, v);
                return v.Light == Light.Green || v.Light == Light.Amber;
            }
            return false;
        }

        string ImageDiff(string relay, string node)
        {
            return "here: relay " + Logic.ShortId(relay) + ", engine " + Logic.ShortId(node) + "; package: relay " + Logic.ShortId(Want("relay")) + ", engine " + Logic.ShortId(Want("node"));
        }

        bool LoadImages()
        {
            long size = 1;
            try { size = Math.Max(1, new FileInfo(L.ImagesTar).Length); } catch { }
            var sw = Stopwatch.StartNew();
            Log.Write("docker load -i " + L.ImagesTar + " (" + (size >> 20) + " MB)");
            var r = Probes.Run(dockerCli ?? "docker", "load -i \"" + L.ImagesTar + "\"", 90 * 60 * 1000, line => Log.Write("docker load: " + line), p =>
            {
                long b = Probes.BytesRead(p);
                int pct = b < 0 ? -1 : (int)Math.Min(99, b * 100 / size);
                Set(StepImages, new Verdict(Light.Busy, "Loading the engine images (first run only): " + (pct >= 0 ? pct + "% of " + (size >> 20) + " MB, " : "") + (int)sw.Elapsed.TotalSeconds + " s."));
            }, null, null);
            Log.Write("docker load: exit " + r.Exit + (r.TimedOut ? " (timed out)" : "") + " after " + (int)sw.Elapsed.TotalSeconds + " s");
            return r.Exit == 0 && !r.TimedOut;
        }

        // ── 3. Engine stack

        ContainerInfo Container(string service, out string error)
        {
            if (!dockerViaCli) return Probes.Container(L.Project, service, out error);
            error = null;
            var ps = Probes.Run(dockerCli, "ps -aq --filter label=com.docker.compose.project=" + L.Project + " --filter label=com.docker.compose.service=" + service, 20000, null, null, null, null);
            if (ps.Exit != 0) { error = "docker didn't answer"; return null; }
            var id = ps.Output.Trim().Split('\n')[0].Trim();
            if (id.Length == 0) return new ContainerInfo { Exists = false };
            var r = Probes.Run(dockerCli, "inspect --format \"{{json .}}\" " + id, 20000, null, null, null, null);
            if (r.Exit != 0) { error = "docker inspect failed"; return null; }
            var o = J.Parse(r.Output.Trim());
            var st = J.Get(o, "State");
            return new ContainerInfo { Exists = true, Id = id, Name = (J.Str(o, "Name") ?? "").TrimStart('/'), State = J.Str(st, "Status"), Health = J.Str(J.Get(st, "Health"), "Status") ?? "", Image = J.Str(o, "Image"), Restarts = J.Int(o, "RestartCount") };
        }

        RunResult Compose(string rest, int timeoutMs)
        {
            Log.Write("docker " + Logic.ComposeArgs(L, rest));
            var r = Probes.Run(dockerCli ?? "docker", Logic.ComposeArgs(L, rest), timeoutMs, line => Log.Write("compose: " + line), null, null, L.Home);
            Log.Write("compose: exit " + r.Exit + (r.TimedOut ? " (timed out)" : ""));
            return r;
        }

        LoginResult Login()
        {
            var r = Probes.RelayLogin("ws://127.0.0.1:9443", relayKey, Logic.Room, 3000);
            loginCache = r; loginAt = DateTime.UtcNow;
            if (r.Kind != LoginKind.Ok) Log.Write("relay login: " + r.Kind + " " + (r.Detail ?? ""));
            return r;
        }

        bool DoStack(bool fresh)
        {
            if (Rows[StepDocker].V.Light != Light.Green) { Set(StepStack, new Verdict(Light.Grey, "Waiting for Docker.")); return Observe; }
            RefreshGame();
            bool locked = IsLocked;
            int autoRestarts = 0;
            if (!locked && !Observe)
            {
                Set(StepStack, new Verdict(Light.Busy, "Starting the engine (relay and Forge room)."));
                var up = Compose(L.Friend ? "up -d" : "up -d --no-recreate", 180000);
                if (up.Exit != 0)
                {
                    Set(StepStack, new Verdict(Light.Red, Logic.ComposeFailure(up.TimedOut ? "timed out" : up.Output, L.Friend)).WithFix(Fixes.StackRestart, "Start the engine"));
                    return false;
                }
                // (a room left over from an earlier game refuses a new start: Start MTG.bat restarts both every time)
                if (L.Friend || fresh)
                {
                    Set(StepStack, new Verdict(Light.Busy, "Opening a fresh room (restarting relay and room)."));
                    if (!RestartRelayRoom()) return false;
                    autoRestarts = 1;
                }
            }
            // (a cold Forge room took 2 min 15 s to open on 2 cores on 2026-11-10: wait 5 minutes)
            var until = DateTime.UtcNow.AddSeconds(StackWaitSeconds);
            int loginFails = 0, busy = 0;
            while (!quit)
            {
                string e1, e2;
                var relay = Container("relay", out e1);
                var room = Container("forge-room", out e2);
                if (e1 != null || e2 != null)
                {
                    Set(StepStack, new Verdict(Light.Red, "Can't read the engine containers: " + (e1 ?? e2) + ".").WithFix(Fixes.Retry, "Try again"));
                    return false;
                }
                bool canLogin = relay != null && relay.Exists && relay.State == "running" && relay.Health != "starting" && !locked;
                var login = canLogin ? Login() : new LoginResult { Kind = LoginKind.Skipped };
                var v = Logic.DecideStack(relay, room, login, Game, L.Friend);
                if (Observe || v.Light == Light.Green || login.Kind == LoginKind.AuthFailed) { Set(StepStack, v); return v.Light == Light.Green; }
                if (locked && v.Light == Light.Red) { Set(StepStack, v); return false; }
                bool broken = canLogin && relay.Health == "healthy" && login.Kind != LoginKind.Ok;
                if (broken) loginFails++;
                if (login.Kind == LoginKind.Ok && login.RoomFound && login.RoomStatus != "Lobby") busy++;
                // the stale 127.0.0.1:9443 forward after `wsl --shutdown`, or a busy room: restart relay and room once by itself
                if ((loginFails >= 3 || busy >= 5) && autoRestarts < 2 && !locked && !Observe)
                {
                    Log.Write(loginFails >= 3 ? "the relay is healthy but logins fail (stale port forward?): restarting relay and room" : "the room stays busy: restarting relay and room");
                    Set(StepStack, new Verdict(Light.Busy, "The relay didn't let this PC in; restarting relay and room."));
                    if (!RestartRelayRoom()) return false;
                    autoRestarts++; loginFails = 0; busy = 0;
                    until = DateTime.UtcNow.AddSeconds(StackWaitSeconds);
                    continue;
                }
                if (DateTime.UtcNow > until)
                {
                    if (v.Light != Light.Red) v = new Verdict(Light.Red, "The engine didn't get ready within " + (StackWaitSeconds / 60) + " minutes: " + v.Text).WithFix(Fixes.StackRestart, "Restart relay and room");
                    Set(StepStack, v);
                    return false;
                }
                Set(StepStack, new Verdict(Light.Busy, "Waiting for the engine: " + v.Text));
                if (!Pause(2000)) return false;
            }
            return false;
        }

        bool RestartRelayRoom()
        {
            var r = Compose("restart relay forge-room", 120000);
            if (r.Exit != 0)
            {
                Set(StepStack, new Verdict(Light.Red, Logic.ComposeFailure(r.TimedOut ? "timed out" : r.Output, L.Friend)).WithFix(Fixes.StackRestart, "Restart relay and room"));
                return false;
            }
            return true;
        }

        // ── 4. Table save (friend mode)

        public InstallState LoadState()
        {
            var o = J.Parse(Probes.ReadText(Path.Combine(StateDir, "state.json")));
            if (o == null) return null;
            return new InstallState { SaveFile = J.Str(o, "saveFile"), SaveHash = J.Str(o, "saveHash"), SavesDir = J.Str(o, "savesDir") };
        }

        void SaveState(InstallState s)
        {
            var d = StateDict();
            d["saveFile"] = s.SaveFile; d["saveHash"] = s.SaveHash; d["savesDir"] = s.SavesDir; d["package"] = L.Home;
            WriteState(d);
        }

        Dictionary<string, object> StateDict()
        {
            return J.Parse(Probes.ReadText(Path.Combine(StateDir, "state.json"))) as Dictionary<string, object> ?? new Dictionary<string, object>();
        }

        // state.json holds the installed save (above) and the image ids Docker gave the package's images at the last
        // load: Docker's containerd image store reports other ids than the classic store `docker save` ran on, so
        // without this the images would load again at every start.
        void RememberImages(string relay, string node)
        {
            var d = StateDict();
            d["images"] = new Dictionary<string, object> { { "wantRelay", Want("relay") }, { "wantNode", Want("node") }, { "relay", relay }, { "node", node } };
            WriteState(d);
        }

        // The package's stack\deployed.json names the ids the bridge expects; after a load, put this Docker's there (the
        // repo's file is deploy.js's and never written here)
        void RewriteDeployed(string relay, string node)
        {
            var next = Logic.DeployedAfterLoad(deployed, relay, node);
            if (next == null) return;
            try
            {
                var tmp = L.DeployedFile + ".tmp";
                File.WriteAllText(tmp, J.Write(next), new UTF8Encoding(false));
                if (File.Exists(L.DeployedFile)) File.Delete(L.DeployedFile);
                File.Move(tmp, L.DeployedFile);
                deployed = next;
                Log.Write("stack\\deployed.json: this Docker's image ids recorded (" + ImageDiff(relay, node) + ")");
            }
            catch (Exception e) { Log.Write("stack\\deployed.json not rewritten: " + e.Message); }
        }

        // the ids to expect: the package's, or the ones Docker reported after loading this same package before
        void ExpectedImages(out string relay, out string node)
        {
            relay = Want("relay"); node = Want("node");
            var im = J.Get(StateDict(), "images");
            if (im != null && J.Str(im, "wantRelay") == relay && J.Str(im, "wantNode") == node && J.Str(im, "relay") != null && J.Str(im, "node") != null)
            {
                relay = J.Str(im, "relay"); node = J.Str(im, "node");
            }
        }

        void WriteState(Dictionary<string, object> d)
        {
            Directory.CreateDirectory(StateDir);
            d["at"] = DateTime.Now.ToString("s");
            var tmp = Path.Combine(StateDir, "state.json.tmp");
            File.WriteAllText(tmp, J.Write(d), new UTF8Encoding(false));
            var dest = Path.Combine(StateDir, "state.json");
            if (File.Exists(dest)) File.Delete(dest);
            File.Move(tmp, dest);
        }

        bool DoSave()
        {
            if (!L.Friend) { Set(StepSave, new Verdict(Light.Grey, "Home mode: you keep your own save (" + saveName + ").")); return true; }
            if (!File.Exists(L.TableJson))
            {
                Set(StepSave, new Verdict(Light.Red, "table\\MTG Table.json is missing from the package. Unzip the package again, then press Try again.").WithFix(Fixes.Retry, "Try again"));
                return false;
            }
            try
            {
                var ours = File.ReadAllBytes(L.TableJson);
                string ourHash = Logic.Sha8(ours);
                string want = Want("save") ?? ourHash;
                if (want != ourHash) Log.Write("note: version.json save " + want + " but table\\MTG Table.json hashes to " + ourHash);
                var existing = Directory.Exists(SavesDir)
                    ? Directory.GetFiles(SavesDir).Select(f => new SaveEntry(Path.GetFileName(f), new FileInfo(f).Length)).ToList()
                    : new List<SaveEntry>();
                var st = LoadState();
                if (st != null && !string.Equals(Path.GetFullPath(st.SavesDir ?? "x:\\"), Path.GetFullPath(SavesDir), StringComparison.OrdinalIgnoreCase)) st = null;
                var plan = Logic.PlanSave(existing, st, want, ourHash, ours.LongLength, n => Logic.Sha8(File.ReadAllBytes(Path.Combine(SavesDir, n))));
                Log.Write("save plan: " + plan + " (" + plan.Text + ") in " + SavesDir);
                if (Observe)
                {
                    Set(StepSave, plan.Kind == SaveKind.Skip || plan.Kind == SaveKind.Adopt
                        ? new Verdict(Light.Green, plan.Text)
                        : new Verdict(Light.Amber, "Would do: " + plan.Text + " (in " + SavesDir + ")"));
                    return true;
                }
                if (plan.Kind == SaveKind.Update) { RefreshGame(); if (IsLocked) { Set(StepSave, new Verdict(Light.Amber, "A newer table is in this package; it installs after the game.")); return true; } }
                Directory.CreateDirectory(SavesDir);
                string target = Path.Combine(SavesDir, plan.File);
                string png = Path.ChangeExtension(target, ".png");
                if (plan.Kind == SaveKind.Install)
                {
                    var tmp = target + ".mtg-companion-tmp";
                    File.WriteAllBytes(tmp, ours);
                    try { File.Move(tmp, target); } // (Move refuses an existing file: never overwrites)
                    catch { try { File.Delete(tmp); } catch { } throw; }
                    if (File.Exists(L.TablePng) && !File.Exists(png)) File.Copy(L.TablePng, png, false);
                }
                else if (plan.Kind == SaveKind.Update)
                {
                    var backup = Path.Combine(StateDir, "backup");
                    Directory.CreateDirectory(backup);
                    File.Copy(target, Path.Combine(backup, Path.GetFileNameWithoutExtension(plan.File) + "-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".json"), false);
                    foreach (var old in new DirectoryInfo(backup).GetFiles("*.json").OrderByDescending(x => x.LastWriteTimeUtc).Skip(5)) try { old.Delete(); } catch { }
                    File.Copy(L.TableJson, target, true);
                    if (File.Exists(L.TablePng)) File.Copy(L.TablePng, png, true);
                }
                // (the hash of the bytes now in that file: PlanSave overwrites it later only while it still hashes to this)
                SaveState(new InstallState { SaveFile = plan.File, SaveHash = ourHash, SavesDir = SavesDir });
                string done = plan.Kind == SaveKind.Skip ? plan.Text
                    : plan.Kind == SaveKind.Adopt ? plan.Text
                    : plan.Kind == SaveKind.Update ? "Updated " + plan.File + " (" + saveName + ")."
                    : "Installed as " + plan.File + " (" + saveName + ").";
                Set(StepSave, new Verdict(Light.Green, done));
                return true;
            }
            catch (Exception e)
            {
                Log.Write("save install failed: " + e);
                Set(StepSave, new Verdict(Light.Red, "Couldn't install the table save: " + e.Message).WithFix(Fixes.Retry, "Try again"));
                return false;
            }
        }

        // ── 5. Bridge

        bool BridgeProcessExists()
        {
            var ids = L.Friend ? Probes.FindProcesses("node.exe", L.BridgeJs) : Probes.FindBridgeNodes();
            return ids == null || ids.Count > 0; // (WMI failed: can't tell, so assume one runs)
        }

        Verdict BridgeVerdict(HttpResult vers)
        {
            var held = Probes.Listeners(39998, 48787);
            var portProblem = Logic.DecidePorts(held, L.Friend ? L.BridgeJs : null, L.Friend);
            bool proc = vers.Kind == HttpKind.Ok ? true : BridgeProcessExists();
            if (portProblem == null && vers.Kind == HttpKind.Refused && !proc && held.Count > 0)
            {
                // a node we couldn't read holds a port, and nothing answers: still not ours to start over
                var l = held[0];
                portProblem = new Verdict(Light.Red, (l.Name ?? "A program") + " (process " + l.Pid + ") holds port " + l.Port + ", which the bridge needs. Close it, then press Try again.").WithFix(Fixes.ShowProgram, "Show the program");
            }
            return Logic.DecideBridge(vers, portProblem, proc, Want("bridge"), L.Friend);
        }

        bool DoBridge()
        {
            bool started = false;
            var t0 = DateTime.UtcNow;
            while (!quit)
            {
                var vers = Probes.HttpGet(BridgeUrl + "/versions", 15000);
                if (vers.Kind == HttpKind.Ok) { versionsCache = vers; versionsAt = DateTime.UtcNow; }
                var v = BridgeVerdict(vers);
                if (v.Light == Light.Red) versionsCache = null; // (another program answers: its table isn't ours to judge)
                if (Observe)
                {
                    if (v.Action == Actions.StartBridge) v = new Verdict(Light.Red, "The bridge isn't running (the app would start it).");
                    Set(StepBridge, v);
                    return v.Light == Light.Green;
                }
                if (v.Action == Actions.StartBridge && !started)
                {
                    // a folder the bridge can't write would only crash it again every 3 s: say so once instead
                    string unwritable = L.Friend ? Logic.WriteProblem(new[] { L.LogsDir, Path.GetDirectoryName(L.BridgeJs) }, TryWrite) : null;
                    if (unwritable != null) { Set(StepBridge, new Verdict(Light.Red, unwritable).WithFix(Fixes.Retry, "Try again")); return false; }
                    Set(StepBridge, v);
                    StartBridge();
                    started = true; t0 = DateTime.UtcNow;
                    if (!Pause(1500)) return false;
                    continue;
                }
                if (v.Light == Light.Green || (v.Light == Light.Amber && !started)) { Set(StepBridge, v); return true; }
                if (v.Light == Light.Red) { Set(StepBridge, v); return false; }
                if ((DateTime.UtcNow - t0).TotalSeconds > 45)
                {
                    var tail = (Probes.Tail(L.BridgeLog, 4000) ?? "").Replace("\r", "").Split('\n').Where(s => s.Trim().Length > 0).Reverse().Take(5).Reverse();
                    var why = string.Join(" | ", tail);
                    string hint = why.Contains("EADDRINUSE") ? " A port it needs is taken by another program." : "";
                    Set(StepBridge, new Verdict(Light.Red, "The bridge didn't start." + hint + " Last log lines: " + Logic.Clip(why, 300)).WithFix(Fixes.BridgeStart, "Start the bridge"));
                    return false;
                }
                Set(StepBridge, started ? new Verdict(Light.Busy, "Starting the bridge (" + (int)(DateTime.UtcNow - t0).TotalSeconds + " s).") : v);
                if (!Pause(1500)) return false;
            }
            return false;
        }

        // null when a file can be made and removed in dir, else why not
        static string TryWrite(string dir)
        {
            try
            {
                Directory.CreateDirectory(dir);
                var f = Path.Combine(dir, ".mtg-companion-write-test");
                File.WriteAllText(f, "x");
                File.Delete(f);
                return null;
            }
            catch (Exception e) { return e.Message; }
        }

        void StartBridge()
        {
            if (L.Friend)
            {
                Log.Write("starting the bridge loop: " + ExePath + " --bridge-loop");
                var psi = new ProcessStartInfo(ExePath, "--bridge-loop --home \"" + L.Home + "\"") { UseShellExecute = false, CreateNoWindow = true };
                Process.Start(psi).Dispose();
            }
            else
            {
                var ps1 = Path.Combine(L.Home, "tools", "start-bridge.ps1");
                Log.Write("starting the bridge: " + ps1);
                var r = Probes.Run("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File \"" + ps1 + "\"", 60000, line => Log.Write("start-bridge: " + line), null, null, L.Home);
                Log.Write("start-bridge: exit " + r.Exit);
            }
        }

        public void StopBridge()
        {
            if (L.Friend)
            {
                Log.Write("stopping the bridge loop and the bridge");
                BridgeLoop.SignalStop();
                Probes.Kill(Probes.FindProcesses(Path.GetFileName(ExePath), "--bridge-loop", L.Home));
                Probes.Kill(Probes.FindProcesses("node.exe", L.BridgeJs));
            }
            else
            {
                var ps1 = Path.Combine(L.Home, "tools", "stop-bridge.ps1");
                Log.Write("stopping the bridge: " + ps1);
                var r = Probes.Run("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File \"" + ps1 + "\"", 60000, line => Log.Write("stop-bridge: " + line), null, null, L.Home);
                Log.Write("stop-bridge: exit " + r.Exit);
            }
        }

        // ── 6. TTS

        bool TtsRunning() { return Probes.ProcessRunning("Tabletop Simulator"); }

        void LaunchTts()
        {
            Log.Write("opening TTS: steam://rungameid/286160");
            try { Process.Start(new ProcessStartInfo("steam://rungameid/286160") { UseShellExecute = true }); ttsLaunched = true; }
            catch (Exception e) { Log.Write("TTS didn't open: " + e.Message); }
        }

        bool DoTts()
        {
            if (!TtsRunning() && !Observe && !ttsLaunched && Probes.SteamFound())
            {
                LaunchTts();
                Set(StepTts, new Verdict(Light.Busy, "Opening Tabletop Simulator through Steam."));
                var until = DateTime.UtcNow.AddSeconds(120);
                while (!TtsRunning() && DateTime.UtcNow < until) if (!Pause(2000)) return false;
            }
            UpdateTts();
            return true;
        }

        void UpdateTts()
        {
            var vers = versionsCache != null && (DateTime.UtcNow - versionsAt).TotalSeconds < 90 ? versionsCache : null;
            var now = vers == null ? null : J.Get(J.Parse(vers.Body), "now");
            var f = new TtsFacts
            {
                Running = TtsRunning(), VersionsOk = vers != null, TableHeard = J.Has(now, "table"), Table = J.Str(now, "table"),
                WantTable = Want("table"), SaveName = saveName, SteamFound = Probes.SteamFound(), Home = !L.Friend,
            };
            Set(StepTts, Logic.DecideTts(f));
        }

        // ───────────────────────────── the watcher ─────────────────────────────

        void MonitorTick()
        {
            RefreshGame();
            if (pendingM != null && !Observe && Updates.InstallNow(IsLocked, idleSince, DateTime.UtcNow, true)) { ApplyUpdate(pendingM, pendingPlan); return; } // (2 minutes after the game: install the update)
            var f = DockerNow();
            if (f.Answers) Set(StepDocker, Logic.DecideDocker(f));
            else Set(StepDocker, new Verdict(f.DesktopRunning ? Light.Amber : Light.Red, f.DesktopRunning ? "Docker Desktop runs, but its engine isn't answering (starting or stopped)." : "Docker isn't running.")
                .WithFix(Fixes.DockerStart, "Start Docker Desktop"));
            if (f.Answers)
            {
                if ((DateTime.UtcNow - imagesAt).TotalMinutes > 5 && Rows[StepImages].V.Light != Light.Busy)
                {
                    imagesAt = DateTime.UtcNow;
                    string e1, e2;
                    var relay = ImageId(Logic.RelayImage, out e1); var node = ImageId(Logic.NodeImage, out e2);
                    if (e1 == null && e2 == null)
                    {
                        string wr = Want("relay"), wn = Want("node");
                        if (L.Friend) ExpectedImages(out wr, out wn);
                        var v = Logic.DecideImages(new ImageFacts { Friend = L.Friend, RelayId = relay, NodeId = node, WantRelay = wr, WantNode = wn, TarPath = L.ImagesTar, Locked = IsLocked });
                        if (v.Action == Actions.Load) v = new Verdict(Light.Amber, "The engine images differ from this package (" + ImageDiff(relay, node) + ").").WithFix(Fixes.ImagesLoad, "Load the engine images");
                        Set(StepImages, v);
                    }
                }
                string ce1, ce2;
                var rc = Container("relay", out ce1); var oc = Container("forge-room", out ce2);
                if (ce1 == null && ce2 == null)
                {
                    LoginResult login;
                    bool canLogin = rc != null && rc.Exists && rc.State == "running" && rc.Health != "starting" && !IsLocked;
                    if (!canLogin) login = new LoginResult { Kind = LoginKind.Skipped };
                    else if (loginCache == null || (DateTime.UtcNow - loginAt).TotalSeconds > 60) login = Login();
                    else login = loginCache;
                    Set(StepStack, Logic.DecideStack(rc, oc, login, Game, L.Friend));
                }
            }
            else
            {
                Set(StepStack, new Verdict(Light.Grey, "Waiting for Docker."));
            }
            // bridge: /versions every 30 s, not more (each call runs docker inspect inside the bridge: 3-4 s)
            if ((DateTime.UtcNow - versionsAt).TotalSeconds > 30)
            {
                var vers = Probes.HttpGet(BridgeUrl + "/versions", 15000);
                if (vers.Kind == HttpKind.Ok) { versionsCache = vers; versionsAt = DateTime.UtcNow; }
                else versionsAt = DateTime.UtcNow.AddSeconds(-25); // (try again in 5 s)
                var v = BridgeVerdict(vers);
                if (v.Action == Actions.StartBridge) v = new Verdict(Light.Red, "The bridge isn't running.").WithFix(Fixes.BridgeStart, "Start the bridge");
                else if (v.Action == Actions.Wait) v = new Verdict(Light.Busy, "The bridge is (re)starting.");
                if (vers.Kind != HttpKind.Ok || v.Light == Light.Red) versionsCache = null;
                Set(StepBridge, v);
            }
            UpdateTts();
            int resume = Logic.ResumeAfterStop(stoppedAt, StepGreen(stoppedAt), Observe);
            if (resume > 0 && pendingFrom == 0)
            {
                Log.Write("step " + stoppedAt + " (" + Names[stoppedAt - 1] + ") is green now: carrying on from step " + resume);
                pendingFrom = resume; wake.Set();
            }
            if (!Observe && Phase.StartsWith("Ready")) SetPhase(Rows.Any(r => r.V.Light == Light.Red) ? "Ready, with a problem: see the red light" : "Ready");
        }

        // ───────────────────────────── buttons and menu ─────────────────────────────

        // a fix button; returns a refusal sentence when the game lock stops it
        public string DoFix(int row, string fix)
        {
            if (Observe) return "Observe mode: nothing is changed.";
            if (Fixes.LocksDuringGame(fix) && IsLocked) return Logic.LockText(Game);
            Log.Write("button: " + fix + " on " + Names[row]);
            switch (fix)
            {
                case Fixes.Retry: Enqueue(() => { pendingFrom = row + 1; }); break;
                case Fixes.DockerStart: Enqueue(() => { StartDockerDesktop(); pendingFrom = 1; }); break;
                case Fixes.ImagesLoad: Enqueue(() => { forceLoad = true; pendingFrom = 2; }); break;
                case Fixes.StackRestart: Enqueue(() => { RefreshGame(); if (IsLocked) return; forceFresh = true; pendingFrom = 3; }); break;
                case Fixes.BridgeRestart: Enqueue(() => { RefreshGame(); if (IsLocked) return; StopBridge(); pendingFrom = 5; }); break;
                case Fixes.BridgeStart: Enqueue(() => { pendingFrom = 5; }); break;
                case Fixes.TtsOpen: Enqueue(() => { LaunchTts(); }); break;
            }
            return null;
        }

        public string RestartEngine()
        {
            if (Observe) return "Observe mode: nothing is changed.";
            if (IsLocked) return Logic.LockText(Game);
            Log.Write("menu: restart engine");
            Enqueue(() =>
            {
                RefreshGame();
                if (IsLocked) { Log.Write("restart refused: " + Game.Text); return; }
                SetPhase("Restarting the engine");
                StopBridge();
                forceFresh = true;
                pendingFrom = 1;
            });
            return null;
        }

        // Stops the bridge and the engine containers; Docker Desktop and TTS stay as they are. done runs on the worker.
        public void StopEverything(Action done)
        {
            if (Observe) { if (done != null) done(); return; }
            Log.Write("menu: stop everything (game: " + Game.Kind + ")");
            Enqueue(() =>
            {
                stopped = true; pendingFrom = 0;
                SetPhase("Stopping");
                StopBridge();
                if (dockerCli != null && Rows[StepDocker].V.Light == Light.Green) Compose(L.Friend ? "down" : "stop", 120000);
                for (int i = 0; i < Rows.Length; i++)
                    if (i != StepDocker) Rows[i].V = new Verdict(Light.Grey, i == StepSave ? (L.Friend ? "Installed (unchanged)." : Rows[i].V.Text) : "Stopped.");
                SetPhase("Stopped. Restart engine starts it again.");
                Fire();
                if (done != null) done();
            });
        }

        // the text dump for --observe --dump
        public string Dump()
        {
            var sb = new StringBuilder();
            sb.AppendLine("MTG Companion " + (Observe ? "observe" : "status") + " at " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
            sb.AppendLine("Mode: " + L.Mode + ", home " + L.Home);
            if (VersionText.Length > 0) sb.AppendLine(VersionText);
            sb.AppendLine("Docker CLI: " + (dockerCli ?? "not found") + "; Docker Desktop: " + (dockerDesktop ?? "not found") + "; reads via " + (dockerViaCli ? "CLI" : "engine pipe"));
            sb.AppendLine("Phase: " + Phase);
            sb.AppendLine("Game: " + Game.Kind + ": " + Game.Text + (IsLocked ? "  [restart buttons locked]" : ""));
            for (int i = 0; i < Rows.Length; i++)
            {
                var v = Rows[i].V;
                sb.AppendLine(string.Format("  {0} {1,-14} [{2,-5}] {3}{4}", i + 1, Rows[i].Name, v.Light.ToString().ToUpperInvariant(), v.Text, v.Fix != null ? "   (button: " + v.FixLabel + (Fixes.LocksDuringGame(v.Fix) && IsLocked ? ", locked" : "") + ")" : ""));
            }
            if (loginCache != null) sb.AppendLine("Relay login: " + loginCache.Kind + (loginCache.RoomFound ? ", room " + loginCache.RoomStatus : ", room not listed") + (loginCache.Detail != null ? " (" + loginCache.Detail + ")" : "") + ", " + loginCache.Ms + " ms");
            else sb.AppendLine("Relay login: not tried (" + (IsLocked ? "locked by the game state" : "relay not ready") + ")");
            return sb.ToString();
        }
    }
}
