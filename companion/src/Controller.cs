// The start sequence (6 steps, one light each), the watcher that keeps the lights current afterwards, and the actions
// behind the fix buttons and the tray menu. Everything runs on one worker thread, so two actions never overlap.
// Nothing that restarts or changes the engine runs while a game is on, or while the app can't tell (Logic.Locked).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
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
        internal static readonly object Gate = new object(); // (LogTrim rolls companion.log under it too)
        public static string File;
        public static void Write(string line)
        {
            if (File == null) return;
            lock (Gate)
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

    // The 14-day log trim's file work; the decisions are Logic's (TrimDue, TrimPlan, ArchivePath, TrimSummary).
    // Never throws: a file that is locked or gone is skipped and named in the one line Run returns.
    // The bridge writes its logs with fs.appendFile (open, write, close per line), so a rename between two lines is safe:
    // the next line starts a new file.
    public static class LogTrim
    {
        public static string StampFile(Layout l) { return Path.Combine(l.LogsDir, Logic.TrimStampName); }

        // the last trim's time: the stamp, else the newest .old roll (Logic.LastTrimOr); null: neither (trim at the next
        // safe moment)
        public static DateTime? LastTrim(Layout l)
        {
            DateTime? stamp = null;
            try
            {
                var f = StampFile(l);
                if (File.Exists(f)) stamp = Logic.ParseTrimStamp(File.ReadAllText(f));
            }
            catch { }
            if (stamp.HasValue) return stamp;
            var rolls = new List<DateTime>();
            foreach (var dir in l.Friend ? new[] { l.LogsDir } : new[] { l.LogsDir, Path.Combine(l.Home, "bridge") })
                foreach (var file in ListFiles(dir))
                    if (Logic.IsTrimRoll(Path.GetFileName(file))) try { rolls.Add(File.GetLastWriteTimeUtc(file)); } catch { }
            return Logic.LastTrimOr(null, rolls);
        }

        // Trims every log in the plan, then writes the stamp (always: a file skipped now waits for the next trim, so a locked
        // one can't make the others roll every hour). Returns the companion-log line.
        public static string Run(Layout l, DateTime nowUtc)
        {
            var done = new List<TrimDone>();
            foreach (var it in Logic.TrimPlan(l, ListFiles, SizeOf)) done.Add(One(l, it, nowUtc));
            try
            {
                Directory.CreateDirectory(l.LogsDir);
                File.WriteAllText(StampFile(l), Logic.TrimStampText(nowUtc));
            }
            catch (Exception e) { done.Add(new TrimDone { Name = Logic.TrimStampName, Error = e.Message }); }
            return Logic.TrimSummary(done);
        }

        static string[] ListFiles(string dir)
        {
            try { return Directory.Exists(dir) ? Directory.GetFiles(dir) : new string[0]; }
            catch { return new string[0]; }
        }

        static long SizeOf(string f)
        {
            try { var fi = new FileInfo(f); return fi.Exists ? fi.Length : -1; }
            catch { return -1; }
        }

        static TrimDone One(Layout l, TrimItem it, DateTime nowUtc)
        {
            var d = new TrimDone { Name = Path.GetFileName(it.Path), Kind = it.Kind, Before = it.Size };
            try
            {
                if (it.Kind == TrimKind.Delete) { File.Delete(it.Path); d.Freed = it.Size; }
                else if (it.Kind == TrimKind.Archive) { d.After = Archive(it.Path, nowUtc.ToLocalTime()); d.Freed = it.Size - d.After; }
                else if (string.Equals(it.Path, l.CompanionLog, StringComparison.OrdinalIgnoreCase)) { lock (Log.Gate) d.Freed = Roll(it.Path); }
                else d.Freed = Roll(it.Path);
            }
            catch (Exception e) { d.Error = e.Message; }
            return d;
        }

        // <name> -> <name>.old, replacing the earlier .old; the bytes freed are the earlier .old's
        static long Roll(string file)
        {
            string old = file + ".old";
            long freed = Math.Max(0, SizeOf(old));
            if (File.Exists(old)) File.Delete(old);
            File.Move(file, old);
            return freed;
        }

        // table-log.log -> table-log.log.trimming (the bridge's next line starts a new file) -> log-archive\table-log-<date>.log.gz,
        // then the .trimming is deleted and the live file is there, empty. A .trimming a failed run left is archived as it is
        // (the plan puts it first). Compression goes to a .part first, so a half-written archive never takes the name.
        // Returns the .gz's size.
        static long Archive(string path, DateTime localNow)
        {
            bool leftover = path.EndsWith(Logic.TrimmingSuffix, StringComparison.OrdinalIgnoreCase);
            string pending = leftover ? path : path + Logic.TrimmingSuffix;
            string live = pending.Substring(0, pending.Length - Logic.TrimmingSuffix.Length);
            if (!leftover) File.Move(path, pending); // (a leftover still in the way: throws, skipped, nothing moved)
            string gz = Logic.ArchivePath(live, localNow, File.Exists), part = gz + ".part";
            Directory.CreateDirectory(Path.GetDirectoryName(gz));
            try
            {
                using (var src = new FileStream(pending, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var dst = new FileStream(part, FileMode.Create, FileAccess.Write, FileShare.None))
                using (var z = new GZipStream(dst, CompressionLevel.Optimal))
                    src.CopyTo(z);
                File.Move(part, gz);
            }
            catch { try { File.Delete(part); } catch { } throw; } // (the .trimming stays: the next trim archives it)
            File.Delete(pending);
            try { using (new FileStream(live, FileMode.OpenOrCreate, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete)) { } }
            catch { } // (the bridge's next line creates it anyway)
            return new FileInfo(gz).Length;
        }
    }

    public partial class Controller
    {
        public const int StepDocker = 0, StepImages = 1, StepStack = 2, StepSave = 3, StepBridge = 4, StepTts = 5;
        public static readonly string[] Names = { "Docker", "Engine images", "Engine stack", "Table save", "Bridge", "TTS" };
        public static string BridgeUrl = "http://127.0.0.1:48787"; // (--bridge-url: tests point it at a fake)
        // Own-server mode (OwnServer.cs, docs/companion-app-spec.md §5.8): --server HOST[:PORT] for this run, else
        // server.json in the package folder. server: null for the engine in Docker on this PC, else the setting (Ok or
        // with a problem). Read at start and at each start sequence. No status-page box sets it (the owner's decision,
        // 2026-11-17): the player writes server.json (its key encrypted for this Windows account, KeyVault) or uses --server.
        public static string ServerArg;
        // how a plain key is encrypted (KeyVault.Protect; the self-test makes it throw to check what is logged)
        public static Func<string, string> KeyProtect = KeyVault.Protect;
        volatile ServerSetting server;
        public ServerSetting Server { get { return server; } }
        bool OnServer { get { return server != null; } }

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
        int pendingFrom, resumeFrom; // (resumeFrom: the step a button press interrupted)
        // Launch only checks: the worker's first turn is one read-only pass of the six steps (checkPending), and nothing
        // starts until Start engine (or a fix button) asks; AutoStart (--start) runs the start sequence at launch instead.
        // engineStarted: a start sequence ran (or the check found the engine already up); until then, parts that are only
        // not running yet are grey and point at Start engine (Logic.BeforeStart). (worker only)
        public bool AutoStart;
        bool checkPending = true, checking, engineStarted;
        bool DryRun { get { return Observe || checking; } } // (observe mode, or the launch check: read only)
        // the first step the last start-sequence run didn't finish: it stopped there on a red light, or a press
        // interrupted it there; 0 when it ran to the end, or after Stop everything (worker only)
        int stoppedAt;
        readonly Dictionary<int, DateTime> busyLogged = new Dictionary<int, DateTime>();
        bool forceFresh, forceLoad, everythingStopped, ttsLaunched; // (everythingStopped: the menu's Stop everything; the watcher pauses)
        object version, deployed;
        DateTime deployedAt;
        string dockerCli, dockerDesktop, saveName, relayKey;
        bool dockerViaCli; DateTime lastCliInfo = DateTime.MinValue; bool lastCliOk;
        HttpResult versionsCache; DateTime versionsAt = DateTime.MinValue, loginAt = DateTime.MinValue, imagesAt = DateTime.MinValue;
        LoginResult loginCache;
        readonly Dictionary<int, DateTime> notified = new Dictionary<int, DateTime>();

        // self-update (friend mode, docs/companion-app-spec.md §11)
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
        // Revert pressed during a game: goes back after it (in updates.json as "pendingRevert"). The update state's
        // RevertWaiting is the one place this is kept, so the page, the tray and the worker can't disagree.
        bool PendingRevert { get { lock (updGate) return updState.RevertWaiting; } }
        DateTime? idleSince; // (no game since then: a waiting update installs 2 minutes after the game)
        public string Recovered; // (Updater.Recover's sentence at this start, or null)
        volatile bool applying;
        public bool Applying { get { return applying; } } // files are moving: Quit and shutdown wait
        public event Action ApplyingChanged;

        public Controller(Layout l, bool observe, string savesDir, string stateDir, string exePath)
        {
            L = l; Observe = observe; SavesDir = savesDir; StateDir = stateDir; ExePath = exePath;
            ReloadPackage();
            if (!L.Friend) Rows[StepSave].V = new Verdict(Light.Grey, "Home mode: tools/deploy.js installs the save (" + saveName + "), so this app leaves it alone. Nothing is wrong.");
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
                RefreshRevert();
                if (J.Str(st, "pendingRevert") != null)
                {
                    // a revert that waited for a game when the app last ran: it still waits (and goes back after the game)
                    var r = Update.Revert;
                    if (r != null && r.Possible && pendingM == null)
                    {
                        SetUpdate(s => { s.Status = "revert-ready"; s.RevertWaiting = true; s.Text = "Revert ready — goes back to " + r.Target + " after the game."; });
                    }
                    else upd.Remember("pendingRevert", null);
                }
            }
        }

        // what Revert would go back to, from the backups as they are now (at start, and after an update or a revert)
        void RefreshRevert()
        {
            if (upd == null) return;
            RevertInfo r;
            try { r = upd.FindRevert(); } catch (Exception e) { r = new RevertInfo { Why = "Couldn't read the backups (" + e.Message + ")." }; }
            SetUpdate(s => { s.Revert = r; });
        }

        // the package's files: at start, and again after an update replaced them
        void ReloadPackage()
        {
            version = L.Friend ? J.Parse(Probes.ReadText(L.VersionFile)) : null;
            deployedAt = DeployedStamp();
            deployed = J.Parse(Probes.ReadText(L.DeployedFile));
            relayKey = Logic.RelayKey(Probes.ReadText(L.EnvFile));
            ReadServer();
            saveName = L.Friend ? (Logic.ReadSaveName(ReadHead(L.TableJson)) ?? Logic.DefaultSaveName) : "Mock MTGA 4 player";
            if (L.Friend) L.ImagesTar = Logic.FindImagesTar(L.Home, File.Exists, d => Directory.Exists(d) ? Directory.GetFiles(d) : new string[0]);
            if (version != null)
                VersionText = "Package " + (J.Str(version, "release") ?? "built " + (J.Str(version, "built") ?? "?")) + ", commit " + (J.Str(version, "gitCommit") ?? "?") + ", table " + (J.Str(version, "table") ?? "?") + ", bridge " + (J.Str(version, "bridge") ?? "?");
            else if (deployed != null)
                VersionText = HomeVersionText();
        }

        string HomeVersionText() { return "Home mode, deployed table " + (J.Str(deployed, "table") ?? "?") + ", bridge " + (J.Str(deployed, "bridge") ?? "?"); }

        DateTime DeployedStamp() { try { return File.GetLastWriteTimeUtc(L.DeployedFile); } catch { return DateTime.MinValue; } }

        // stack\deployed.json again when it changed on disk: in home mode tools/deploy.js rewrites it while the app runs,
        // and a copy read at launch would call the newly deployed bridge and images wrong (and a restarted bridge "didn't start")
        internal void RefreshDeployed()
        {
            var t = DeployedStamp();
            if (t == deployedAt) return;
            var d = J.Parse(Probes.ReadText(L.DeployedFile));
            if (d == null) return; // (half written: the next turn reads it)
            deployedAt = t;
            deployed = d;
            if (version == null) VersionText = HomeVersionText();
            Log.Write("stack\\deployed.json changed: read again (bridge " + (J.Str(d, "bridge") ?? "?") + ", table " + (J.Str(d, "table") ?? "?") + ")");
        }

        // server.json (or --server) again; the Engine stack row is named for the mode. Never logs the key.
        void ReadServer()
        {
            var was = server;
            string resave, problem, protectError = null;
            Func<string, string> protect = k =>
            {
                try { return KeyProtect(k); }
                catch (Exception e) { protectError = e.GetType().Name + ": " + Logic.Clip(e.Message, 160); throw; }
            };
            var opened = OwnServer.OpenKey(Probes.ReadText(L.ServerFile), KeyVault.Unprotect, protect, out resave, out problem);
            // (encryption failing: the file stays as it is and the game still plays; said once, never with the key)
            if (protectError != null && !Observe) Log.Write(OwnServer.File + ": the key couldn't be encrypted for this Windows account (" + protectError + "); server.json stays as it is");
            server = problem != null ? ServerSetting.Bad(problem) : OwnServer.SettingOf(opened, ServerArg, Environment.GetEnvironmentVariable(OwnServer.KeyVariable));
            // (a plain key: saved again encrypted for this Windows account, once; never in observe mode)
            if (resave != null && !Observe)
            {
                try
                {
                    var tmp = L.ServerFile + ".tmp";
                    File.WriteAllText(tmp, resave);
                    if (File.Exists(L.ServerFile)) File.Replace(tmp, L.ServerFile, null); else File.Move(tmp, L.ServerFile);
                    Log.Write(OwnServer.File + ": the key is now encrypted for this Windows account (DPAPI)");
                }
                catch (Exception e) { Log.Write(OwnServer.File + ": the key couldn't be encrypted (" + e.Message + "); it stays as it is"); }
            }
            Rows[StepStack].Name = server != null ? OwnServer.RowName : Names[StepStack];
            string now = server == null ? "this PC's engine" : server.Ok ? "your server " + OwnServer.Words(server.Server) : "a server setting with a problem: " + server.Problem;
            string before = was == null ? "this PC's engine" : was.Ok ? "your server " + OwnServer.Words(was.Server) : "a server setting with a problem: " + was.Problem;
            if (was == null && server == null) return;
            if (now != before || was == null) Log.Write("engine: " + now);
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
            if (!Observe) Log.Write(AutoStart ? "launch: --start: running the start sequence" : "launch: checking only; Start engine starts the engine");
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
            if (PendingRevert) return Updates.RevertWaitsText; // (else the update installs after the game and the revert then undoes it)
            if (r == null || !r.Available) return "No update to install: check for updates first.";
            UpdateNow(r);
            return null;
        }
        // Revert update: the previous version from the newest backup (on the worker; a game on: after it)
        public string RevertNow()
        {
            if (upd == null) return Observe ? "Observe mode: no updates." : "Home mode: the repo updates with git, not here.";
            if (UpdateBusy) return "An update is already being checked, downloaded or installed.";
            if (pendingM != null) return "Update " + pendingM.Version + " is waiting for the game to end; revert after it is installed.";
            if (PendingRevert) return "The revert is already waiting for the game to end.";
            RefreshRevert();
            var r = Update.Revert;
            if (r == null || !r.Possible) return r != null && r.Why != null ? r.Why : Updates.NoBackup;
            updateBusy = true; // (until DoRevert ends: a second press, a check or Update now waits)
            SetUpdate(s => { s.Status = "reverting"; s.Error = null; s.Text = "Going back to " + r.Target + "…"; });
            Enqueue(DoRevert);
            return null;
        }

        // on the worker
        void DoRevert()
        {
            updateBusy = true;
            var was = Phase;
            var target = Update.Revert != null ? Update.Revert.Target : null;
            SetPhase("Going back to " + (target ?? "the earlier version"));
            SetUpdate(s => { s.Status = "reverting"; s.RevertWaiting = false; });
            ApplyResult res;
            SetApplying(true);
            try { res = upd.Revert(new Effects(this), ""); }
            catch (Exception e) { Log.Write("revert: " + e); res = new ApplyResult { Text = "The revert failed (" + e.Message + ")." }; }
            finally { SetApplying(false); updateBusy = false; }
            Log.Write("revert: " + res.Text);
            if (res.Ok) lock (updGate) offer = null; // (planned against the newer package)
            SetUpdate(s => s.Reverted(res));
            RefreshRevert();
            if (res.Deferred) { SetPhase(was); return; } // (Reverted set RevertWaiting: Tick goes back after the game)
            if (res.Swapping) { var h = ExitForUpdate; if (h != null) h(); return; }
            pendingFrom = 1; // (the lights again, from the package as it is now)
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
                    var r = upd.Check(manual);
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
            RefreshRevert(); // (a new backup: Revert goes back to the version just replaced)
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

        // --watch-once (with --dump): one pass of the watcher on the worker, after the first pass, so a dump shows the
        // watcher's own lights (MonitorServer's, with the table's engine build) and not only the start sequence's.
        // True when it ran within the time.
        public bool WatchOnce(int timeoutMs)
        {
            var done = new ManualResetEvent(false);
            Enqueue(() => { Safe(MonitorTick, "watch once"); done.Set(); });
            return done.WaitOne(timeoutMs);
        }

        void Loop()
        {
            while (!quit)
                if (!WorkOnce(MonitorTick)) wake.WaitOne(WindowVisible ? 5000 : 15000);
        }

        // One turn of the worker: a queued press, else a queued start-sequence run, else the watcher and then the
        // carry-on check. True: it ran a press or a run (go round again at once); false: it watched (wait for the next
        // tick). The self-test drives this with a fake watcher, the worker thread never started.
        internal bool WorkOnce(Action watch)
        {
            Safe(RefreshDeployed, "deployed.json");
            Action a = null;
            lock (q) if (work.Count > 0) a = work.Dequeue();
            if (a != null)
            {
                cancel = false;
                Safe(a, "action");
                // a press that interrupted the start sequence: carry on from that step, unless the press restarted or stopped it
                if (pendingFrom == 0 && resumeFrom > 0 && !everythingStopped) pendingFrom = resumeFrom;
                resumeFrom = 0;
                return true;
            }
            if (checkPending && AutoStart && !Observe) { checkPending = false; pendingFrom = 1; } // (--start: the launch runs the start sequence)
            if (pendingFrom > 0)
            {
                checkPending = false; // (a start before the launch check ran: the run is the check)
                int from = StartAt(pendingFrom); pendingFrom = 0; cancel = false;
                Safe(() => RunSequence(from), "start sequence");
                FirstPassDone = true;
                Fire();
                return true;
            }
            if (checkPending)
            {
                checkPending = false; cancel = false;
                CheckPass();
                FirstPassDone = true;
                Fire();
                return true;
            }
            if (!everythingStopped) { Safe(watch, "watch"); ResumeIfGreen(); }
            else Safe(KeepTtsRowStopped, "tts row");
            FirstPassDone = true;
            return false;
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

        // step: 1-6, as the sequence counts; anything else is not green
        internal bool StepGreen(int step) { return step > 0 && step <= Rows.Length && Rows[step - 1].V.Light == Light.Green; }

        // the step a run asked to start at requested really starts at (Logic.StartFrom against the last stop)
        internal int StartAt(int requested) { return Logic.StartFrom(requested, stoppedAt, StepGreen(stoppedAt)); }

        // after each watcher tick: once the step the sequence stopped at has turned green by itself, queue the rest of
        // the sequence (Logic.ResumeAfterStop). A run already queued is kept (the watcher's update install queues one
        // from step 1; StartAt still holds it to the first step not done).
        internal void ResumeIfGreen()
        {
            int resume = Logic.ResumeAfterStop(stoppedAt, StepGreen(stoppedAt), Observe);
            if (resume == 0 || pendingFrom != 0) return;
            Log.Write("step " + stoppedAt + " (" + Names[stoppedAt - 1] + ") is green now: carrying on from step " + resume);
            pendingFrom = resume; wake.Set();
        }

        internal int StoppedAt { get { return stoppedAt; } }
        internal int PendingFrom { get { return pendingFrom; } }

        void Fire() { var c = Changed; if (c != null) try { c(); } catch { } }

        void Set(int i, Verdict v)
        {
            var row = Rows[i];
            bool changed = row.V == null || row.V.Light != v.Light || row.V.Text != v.Text || row.V.Fix != v.Fix;
            bool worthLogging = row.V == null || row.V.Fix != v.Fix || Logic.LogLightChange(row.V.Light, row.V.Text, v.Light, v.Text);
            row.V = v; row.At = DateTime.Now;
            if (changed)
            {
                // (a progress line every second would flood the log: busy text changes go in at most every 15 s; a green
                // light whose numbers alone moved, never)
                DateTime lastBusy;
                bool progress = !worthLogging || (v.Light == Light.Busy && busyLogged.TryGetValue(i, out lastBusy) && (DateTime.Now - lastBusy).TotalSeconds < 15);
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
            var st = Logic.StateForLock(Probes.HttpGet(BridgeUrl + "/state", 5000), () => Probes.Listeners(48787));
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
            // (after Stop everything the engine's containers are stopped too, so no game can come back: a fresh resume
            // file must not keep Restart engine locked, 2026-11-13 the lock stayed on with everything stopped)
            var g = everythingStopped && st.Kind == HttpKind.Refused ? Game.None("No game (everything was stopped).") : Logic.DecideGame(st, age);
            bool changed = Game == null || Game.Kind != g.Kind || Game.Text != g.Text;
            Game = g;
            if (Logic.Locked(g)) idleSince = null; else if (!idleSince.HasValue) idleSince = DateTime.UtcNow;
            if (changed) { Log.Write("game: " + g.Kind + ": " + g.Text); Fire(); }
        }

        public bool IsLocked { get { return Logic.Locked(Game); } }

        // ───────────────────────────── the start sequence ─────────────────────────────

        // the launch's check: the six steps read only (each Do* treats it as observe mode, with Start engine's words);
        // nothing is started, loaded, installed or opened
        internal void CheckPass()
        {
            checking = !Observe;
            try { Safe(() => RunSequence(1), "check"); }
            finally { checking = false; }
        }

        // the Start engine button: the start sequence from step 1, as every launch ran it before (2026-11-14)
        public string StartEngine()
        {
            if (Observe) return "Observe mode: nothing is changed.";
            Log.Write("button: start engine");
            Enqueue(() => { everythingStopped = false; pendingFrom = 1; });
            return null;
        }

        // nothing has been started yet (launch only checked, or Stop everything ran) and no start is queued: the page
        // and the window point at Start engine
        public bool NeedsStart { get { return !Observe && !engineStarted && pendingFrom == 0; } }

        // a light as shown before Start engine (Logic.BeforeStart), else as decided
        Verdict Unstarted(int step, Verdict v) { return engineStarted || Observe ? v : Logic.BeforeStart(step, v); }

        internal void RunSequence(int from)
        {
            ReadServer(); // (a server.json written since, or fixed after a red light: Try again reads it)
            everythingStopped = false; stoppedAt = 0;
            if (!DryRun) engineStarted = true;
            bool fresh = forceFresh; forceFresh = false;
            for (int step = from; step <= 6 && !quit; step++)
            {
                if (OnlySteps != null && !OnlySteps.Contains(step)) { Rows[step - 1].V = new Verdict(Light.Grey, "Skipped (--steps)."); continue; }
                SetPhase(Observe ? "Checking (observe only)" : checking ? "Checking: step " + step + " of 6" : "Starting: step " + step + " of 6");
                bool ok;
                switch (step - 1)
                {
                    case StepDocker: ok = OnServer ? NotHere(StepDocker) : DoDocker(); break;
                    case StepImages: ok = OnServer ? NotHere(StepImages) : DoImages(); break;
                    case StepStack: ok = OnServer ? DoServer() : DoStack(fresh); break;
                    case StepSave: ok = DoSave(); break;
                    case StepBridge: ok = DoBridge(); break;
                    default: ok = DoTts(); break;
                }
                // (stoppedAt too: a press for a later step must not skip this unfinished one, Logic.StartFrom)
                // (the launch check cut short by a press: nothing to resume, the check runs again unless the press starts)
                if (cancel && !quit && checking) { checkPending = true; return; }
                if (cancel && !quit) { resumeFrom = step; stoppedAt = step; SetPhase("Interrupted"); return; }
                if (!ok && !DryRun)
                {
                    stoppedAt = step;
                    SetPhase("Stopped at step " + step + " (" + Names[step - 1] + "): see the red light");
                    for (int k = step; k < 6; k++) Rows[k].V = new Verdict(Light.Grey, "Waiting for " + Names[step - 1] + ".");
                    if (!L.Friend) Rows[StepSave].V = new Verdict(Light.Grey, "Home mode: tools/deploy.js installs the save (" + saveName + "), so this app leaves it alone. Nothing is wrong.");
                    Fire();
                    return;
                }
            }
            if (checking && Logic.EngineUp(Rows.Select(r => r.V.Light).ToList())) { engineStarted = true; Log.Write("launch check: the engine is already up"); }
            SetPhase(Observe ? "Observing (no changes)" : checking && !engineStarted ? Logic.NotStartedPhase : "Ready");
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
                if (DryRun && v.Action != null) v = checking ? Logic.BeforeStart(StepDocker, v) : new Verdict(Light.Red, f.DesktopRunning ? "Docker Desktop runs, but its engine isn't answering." : "Docker isn't running (the app would start Docker Desktop).");
                Set(StepDocker, v);
                if (v.Light == Light.Green) return true;
                if (v.Light == Light.Red || DryRun) return false;
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
            if (!Rows[StepDocker].V.Light.Equals(Light.Green)) { Set(StepImages, new Verdict(Light.Grey, "Waiting for Docker.")); return DryRun; }
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
                if (v.Action == Actions.Load && !DryRun)
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
                if (checking && v.Action == Actions.Load) v = Logic.BeforeStart(StepImages, v);
                else if (Observe && v.Action == Actions.Load) v = new Verdict(Light.Amber, "Would load the engine images from " + Path.GetFileName(L.ImagesTar) + " (" + ImageDiff(relay, node) + ").");
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
            var s = server;
            var r = s != null && s.Ok ? Probes.RelayLogin(OwnServer.Url(s.Server), s.Server.Key, Logic.Room, 5000)
                : Probes.RelayLogin("ws://127.0.0.1:9443", relayKey, Logic.Room, 3000);
            loginCache = r; loginAt = DateTime.UtcNow;
            if (r.Kind != LoginKind.Ok) Log.Write("relay login: " + r.Kind + " " + (r.Detail ?? ""));
            return r;
        }

        // ── own server: steps 1 and 2 have nothing to run here, step 3 asks the server whether it answers

        bool NotHere(int step)
        {
            var s = server;
            Set(step, s != null && s.Ok ? OwnServer.NotNeeded(s.Server) : OwnServer.WaitingForSetting());
            return true;
        }

        bool DoServer()
        {
            var s = server;
            RefreshGame();
            if (s == null || !s.Ok) { Set(StepStack, OwnServer.Decide(s, null, Game)); return false; }
            Set(StepStack, new Verdict(Light.Busy, "Asking your server (" + OwnServer.Words(s.Server) + ")."));
            var login = IsLocked ? new LoginResult { Kind = LoginKind.Skipped } : Login();
            var v = OwnServer.Decide(s, login, Game, J.Str(deployed, "engineBuild"));
            Set(StepStack, v);
            // (amber: the server's engine build isn't the table's; said, and the start goes on)
            return v.Light == Light.Green || v.Light == Light.Amber;
        }

        bool DoStack(bool fresh)
        {
            if (Rows[StepDocker].V.Light != Light.Green) { Set(StepStack, new Verdict(Light.Grey, "Waiting for Docker.")); return DryRun; }
            RefreshGame();
            bool locked = IsLocked;
            int autoRestarts = 0;
            if (!locked && !DryRun)
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
            var until = DateTime.UtcNow.AddSeconds(Logic.StackWaitSeconds);
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
                var v = Unstarted(StepStack, Logic.DecideStack(relay, room, login, Game, L.Friend));
                if (DryRun || v.Light == Light.Green || login.Kind == LoginKind.AuthFailed) { Set(StepStack, v); return v.Light == Light.Green; }
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
                    until = DateTime.UtcNow.AddSeconds(Logic.StackWaitSeconds);
                    continue;
                }
                if (DateTime.UtcNow > until)
                {
                    if (v.Light != Light.Red) v = new Verdict(Light.Red, Logic.StackTimedOut(v.Text)).WithFix(Fixes.StackRestart, "Restart relay and room");
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

        // The table this host made, in the package's stack\deployed.json (its Workshop copy made another than the package's)
        void RewriteDeployedTable(string stamp)
        {
            var next = Logic.DeployedWithTable(deployed, stamp);
            if (next == null) return;
            try
            {
                var tmp = L.DeployedFile + ".tmp";
                File.WriteAllText(tmp, J.Write(next), new UTF8Encoding(false));
                if (File.Exists(L.DeployedFile)) File.Delete(L.DeployedFile);
                File.Move(tmp, L.DeployedFile);
                deployed = next;
                Log.Write("stack\\deployed.json: this host's table " + stamp + " recorded");
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

        // The Workshop table the package makes its table from: version.json "workshop" (id, url), else the 4-player one.
        // (A 6-player table, once its profile exists, comes as a second entry of version.json "tables"; this step
        // makes the first, required one.)
        string WorkshopId { get { return J.Str(J.Get(version, "workshop"), "id") ?? Logic.TableWorkshopId; } }
        string WorkshopLink { get { return J.Str(J.Get(version, "workshop"), "url") ?? Logic.WorkshopUrl(WorkshopId); } }
        // the table stamp this host's Workshop copy made, when that isn't the package's (the TTS light expects it)
        string builtStamp;

        // runs the package's table\make-table.js with its own Node: the Workshop copy in, the table out (tests: a fake)
        public Func<string, string, TableBuild> BuildTable;
        public Func<string> SteamDir = Probes.SteamPath; // (tests: none, so only the folder beside Saves counts)
        TableBuild RunMakeTable(string workshop, string outFile)
        {
            var script = Path.Combine(L.Home, "table", "make-table.js");
            if (!File.Exists(script)) return new TableBuild { Error = "table\\make-table.js is missing from the package. Unzip the package again" };
            var r = Probes.Run(L.NodeExe, Logic.MakeTableArgs(script, workshop, outFile), 120000, null, null, null, L.Home);
            if (r.Error != null) return new TableBuild { Error = "couldn't run " + L.NodeExe + ": " + r.Error };
            if (r.TimedOut) return new TableBuild { Error = "the patcher took over 2 minutes" };
            return Logic.ParseMakeTable(r.Exit, r.Output);
        }

        bool DoSave()
        {
            if (!L.Friend) { Set(StepSave, new Verdict(Light.Grey, "Home mode: tools/deploy.js installs the save (" + saveName + "), so this app leaves it alone. Nothing is wrong.")); return true; }
            // the table: made here from the host's own Workshop copy (the package ships none)
            var tried = Logic.WorkshopCandidates(SavesDir, SteamDir == null ? null : SteamDir(), WorkshopId);
            string workshop = tried.FirstOrDefault(File.Exists);
            if (workshop == null)
            {
                Log.Write("no Workshop table " + WorkshopId + "; looked in: " + string.Join(" | ", tried));
                Set(StepSave, Logic.WorkshopMissing(WorkshopLink, tried));
                return false;
            }
            // (a check makes it in a temp file: it changes nothing, not even the package's table folder)
            string made = DryRun ? Path.Combine(Path.GetTempPath(), "mtg-companion-table-" + Guid.NewGuid().ToString("N").Substring(0, 8) + ".json") : L.TableJson;
            try
            {
                Directory.CreateDirectory(Path.GetDirectoryName(made));
                var b = (BuildTable ?? RunMakeTable)(workshop, made);
                Log.Write("table from " + workshop + ": " + (b.Ok ? "stamp " + b.Stamp + ", save " + b.Save + ", Workshop copy " + b.Workshop : "failed: " + b.Error));
                if (!b.Ok || !File.Exists(made))
                {
                    Set(StepSave, b.Missing ? Logic.WorkshopMissing(WorkshopLink, tried) : Logic.TableBuildFailed(b.Ok ? new TableBuild { Error = "it wrote nothing" } : b));
                    return false;
                }
                var ours = File.ReadAllBytes(made);
                string ourHash = Logic.Sha8(ours);
                string packageSave = Want("save");
                if (packageSave != null && packageSave != ourHash) Log.Write("note: this Workshop copy made save " + ourHash + " (stamp " + b.Stamp + "), the package was checked with " + packageSave + " (" + Want("table") + ")");
                builtStamp = b.Stamp != null && b.Stamp != Want("table") ? b.Stamp : null;
                if (!DryRun && builtStamp != null) RewriteDeployedTable(builtStamp);
                string want = ourHash; // (what goes into the save is what was just made)
                var existing = Directory.Exists(SavesDir)
                    ? Directory.GetFiles(SavesDir).Select(f => new SaveEntry(Path.GetFileName(f), new FileInfo(f).Length)).ToList()
                    : new List<SaveEntry>();
                var st = LoadState();
                if (st != null && !string.Equals(Path.GetFullPath(st.SavesDir ?? "x:\\"), Path.GetFullPath(SavesDir), StringComparison.OrdinalIgnoreCase)) st = null;
                var plan = Logic.PlanSave(existing, st, want, ourHash, ours.LongLength, n => Logic.Sha8(File.ReadAllBytes(Path.Combine(SavesDir, n))));
                Log.Write("save plan: " + plan + " (" + plan.Text + ") in " + SavesDir);
                if (DryRun)
                {
                    Set(StepSave, plan.Kind == SaveKind.Skip || plan.Kind == SaveKind.Adopt
                        ? Logic.SaveDone(plan.Text, ourHash, packageSave, b.Stamp, Want("table"))
                        : checking ? new Verdict(Light.Grey, "Start engine does this: " + plan.Text)
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
                Set(StepSave, Logic.SaveDone(done, ourHash, packageSave, b.Stamp, Want("table")));
                return true;
            }
            catch (Exception e)
            {
                Log.Write("save install failed: " + e);
                Set(StepSave, new Verdict(Light.Red, "Couldn't install the table save: " + e.Message).WithFix(Fixes.Retry, "Try again"));
                return false;
            }
            finally { if (DryRun) try { File.Delete(made); File.Delete(Path.ChangeExtension(made, ".png")); } catch { } }
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
            var v = Logic.DecideBridge(vers, portProblem, proc, Want("bridge"), L.Friend);
            // (a bridge running for the other engine: this PC's while a server is set, or a server while none is)
            var s = server;
            if (vers.Kind == HttpKind.Ok && v.Light != Light.Red && (s == null || s.Ok) && OwnServer.RelayDiffers(vers.Body, s == null ? null : s.Server))
                return OwnServer.BridgeForOtherEngine(s == null ? null : s.Server);
            return v;
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
                if (DryRun)
                {
                    if (checking) v = Logic.BeforeStart(StepBridge, v);
                    else if (v.Action == Actions.StartBridge) v = new Verdict(Light.Red, "The bridge isn't running (the app would start it).");
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
                    // it runs and answers, only not the expected version: say that, not "didn't start"
                    if (v.Light == Light.Amber) { Set(StepBridge, v); return true; }
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
                Process.Start(BridgeLoopInfo()).Dispose();
            }
            else
            {
                var ps1 = Path.Combine(L.Home, "tools", "start-bridge.ps1");
                Log.Write("starting the bridge: " + ps1);
                var appData = BridgeAppData();
                var env = EngineEnv();
                if (appData != null) env["APPDATA"] = appData;
                var r = Probes.Run("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File \"" + ps1 + "\"", 60000, line => Log.Write("start-bridge: " + line), null, env, L.Home);
                Log.Write("start-bridge: exit " + r.Exit);
            }
        }

        // the hidden bridge loop's process (friend mode): its environment carries APPDATA when this app has none, and the
        // engine the bridge connects to (EngineEnv). The self-test reads it.
        internal ProcessStartInfo BridgeLoopInfo()
        {
            var psi = new ProcessStartInfo(ExePath, "--bridge-loop --home \"" + L.Home + "\"") { UseShellExecute = false, CreateNoWindow = true };
            var appData = BridgeAppData();
            if (appData != null) psi.EnvironmentVariables["APPDATA"] = appData;
            foreach (var kv in EngineEnv()) psi.EnvironmentVariables[kv.Key] = kv.Value;
            return psi;
        }

        // the engine the bridge connects to (OwnServer.BridgeEnv): the server's relay and key, or this PC's (the server
        // variables emptied). The key goes only into the bridge's environment, never into a log.
        internal Dictionary<string, string> EngineEnv()
        {
            var s = server;
            if (s != null && s.Ok) Log.Write("the bridge connects to your server " + OwnServer.Words(s.Server));
            return OwnServer.BridgeEnv(s != null && s.Ok ? s.Server : null);
        }

        // the APPDATA the bridge must get when this app runs without one (Logic.AppDataFor); null: it inherits ours
        internal static string BridgeAppData()
        {
            var a = Logic.AppDataFor(Environment.GetEnvironmentVariable("APPDATA"), Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData));
            if (a != null) Log.Write("APPDATA isn't set for this app: the bridge gets " + a);
            return a;
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

        // (a field so the self-test can answer it; nothing else replaces it)
        internal Func<bool> TtsProbe = () => Probes.ProcessRunning("Tabletop Simulator");
        bool TtsRunning() { return TtsProbe(); }

        // (WorkOnce, while Stop everything is in effect and the watcher pauses) the TTS row follows TTS: opened or closed
        // after the stop, it says so, as the other rows stay stopped
        internal void KeepTtsRowStopped()
        {
            var v = Logic.TtsAfterStop(TtsRunning());
            if (Rows[StepTts].V != null && Rows[StepTts].V.Text == v.Text) return;
            Set(StepTts, v); // (its time too: the page shows when the row last changed)
            Fire();
        }

        void LaunchTts()
        {
            Log.Write("opening TTS: steam://rungameid/286160");
            try { Process.Start(new ProcessStartInfo("steam://rungameid/286160") { UseShellExecute = true }); ttsLaunched = true; }
            catch (Exception e) { Log.Write("TTS didn't open: " + e.Message); }
        }

        bool DoTts()
        {
            if (!TtsRunning() && !DryRun && !ttsLaunched && Probes.SteamFound())
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
            var body = vers == null ? null : J.Parse(vers.Body);
            var now = J.Get(body, "now");
            // (when the table last spoke, as of now: the bridge's answer is up to 90 s old)
            double? heardAgo = J.Get(body, "tableHeardMs") == null ? (double?)null : J.Int(body, "tableHeardMs") / 1000.0 + (DateTime.UtcNow - versionsAt).TotalSeconds;
            var ttsStart = Probes.ProcessStartUtc("Tabletop Simulator");
            var f = new TtsFacts
            {
                Running = TtsRunning(), VersionsOk = vers != null, TableHeard = J.Has(now, "table"), Table = J.Str(now, "table"),
                WantTable = builtStamp ?? Want("table"), SaveName = saveName, SteamFound = Probes.SteamFound(), Home = !L.Friend,
                TableHeardAgoSec = heardAgo, TtsUpSec = ttsStart.HasValue ? (DateTime.UtcNow - ttsStart.Value).TotalSeconds : (double?)null,
            };
            Set(StepTts, Logic.DecideTts(f));
        }

        // ───────────────────────────── the watcher ─────────────────────────────

        void MonitorTick()
        {
            RefreshGame();
            if (pendingM != null && !Observe && Updates.InstallNow(IsLocked, idleSince, DateTime.UtcNow, true)) { ApplyUpdate(pendingM, pendingPlan); return; } // (2 minutes after the game: install the update)
            if (PendingRevert && !Observe && !updateBusy && Updates.InstallNow(IsLocked, idleSince, DateTime.UtcNow, true)) { DoRevert(); return; } // (and a revert that waited)
            if (OnServer) MonitorServer(); else MonitorDocker();
            MonitorBridgeAndTts();
        }

        // the watcher with a server: no Docker here; the server is asked again every minute (not during a game)
        void MonitorServer()
        {
            var s = server;
            NotHere(StepDocker); NotHere(StepImages);
            if (s == null || !s.Ok) { Set(StepStack, OwnServer.Decide(s, null, Game)); return; }
            LoginResult login;
            if (IsLocked) login = new LoginResult { Kind = LoginKind.Skipped };
            else if (loginCache == null || (DateTime.UtcNow - loginAt).TotalSeconds > 60) login = Login();
            else login = loginCache;
            Set(StepStack, OwnServer.Decide(s, login, Game, J.Str(deployed, "engineBuild")));
        }

        void MonitorDocker()
        {
            var f = DockerNow();
            if (f.Answers) Set(StepDocker, Logic.DecideDocker(f));
            else if (!engineStarted && !Observe) Set(StepDocker, Logic.BeforeStart(StepDocker, Logic.DecideDocker(f))); // (before Start engine: no red light for a Docker nobody asked to start)
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
                        var v = Unstarted(StepImages, Logic.DecideImages(new ImageFacts { Friend = L.Friend, RelayId = relay, NodeId = node, WantRelay = wr, WantNode = wn, TarPath = L.ImagesTar, Locked = IsLocked }));
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
                    if (!canLogin) { login = new LoginResult { Kind = LoginKind.Skipped }; watchBrokenLogins = 0; }
                    else if (loginCache == null || (DateTime.UtcNow - loginAt).TotalSeconds > 60)
                    {
                        login = Login();
                        watchBrokenLogins = rc.Health == "healthy" && Logic.LoginBroken(login.Kind) ? watchBrokenLogins + 1 : 0;
                    }
                    else login = loginCache;
                    Set(StepStack, Unstarted(StepStack, Logic.DecideStack(rc, oc, login, Game, L.Friend)));
                    if (Logic.HealRelayNow(watchBrokenLogins, IsLocked, Observe, (DateTime.UtcNow - lastHeal).TotalMinutes)) HealRelay();
                }
            }
            else
            {
                // (the images can't be read either: "Present" stayed green while Docker was quit, break-it test
                // 2026-11-13; imagesAt reset, so they are read again on the first tick Docker answers; the last login
                // dropped, so a Docker that comes back isn't shown "Ready" from a login made before it went)
                if (Rows[StepImages].V.Light != Light.Busy) { Set(StepImages, new Verdict(Light.Grey, "Waiting for Docker.")); imagesAt = DateTime.MinValue; }
                loginCache = null; watchBrokenLogins = 0;
                Set(StepStack, new Verdict(Light.Grey, "Waiting for Docker."));
            }
        }

        void MonitorBridgeAndTts()
        {
            // bridge: /versions every 30 s, not more (each call runs docker inspect inside the bridge: 3-4 s)
            if ((DateTime.UtcNow - versionsAt).TotalSeconds > 30)
            {
                var vers = Probes.HttpGet(BridgeUrl + "/versions", 15000);
                if (vers.Kind == HttpKind.Ok) { versionsCache = vers; versionsAt = DateTime.UtcNow; }
                else versionsAt = DateTime.UtcNow.AddSeconds(-25); // (try again in 5 s)
                var v = Unstarted(StepBridge, BridgeVerdict(vers));
                if (v.Action == Actions.StartBridge) v = new Verdict(Light.Red, "The bridge isn't running.").WithFix(Fixes.BridgeStart, "Start the bridge");
                else if (v.Action == Actions.Wait) v = new Verdict(Light.Busy, "The bridge is (re)starting.");
                if (vers.Kind != HttpKind.Ok || v.Light == Light.Red) versionsCache = null;
                Set(StepBridge, v);
            }
            UpdateTts();
            // (the engine came up without Start engine, e.g. Start MTG.bat or a companion that was restarted: it counts as started)
            if (!engineStarted && !Observe && pendingFrom == 0 && Logic.EngineUp(Rows.Select(r => r.V.Light).ToList()))
            {
                engineStarted = true; Log.Write("the engine is up (started outside this app): watching it as started");
                if (Phase == Logic.NotStartedPhase || Phase == Logic.StoppedPhase) SetPhase("Ready");
            }
            if (!Observe && Phase.StartsWith("Ready")) SetPhase(Rows.Any(r => r.V.Light == Light.Red) ? "Ready, with a problem: see the red light" : "Ready");
            MaybeTrimLogs();
        }

        int watchBrokenLogins; // (fresh watcher logins in a row the healthy relay refused)
        DateTime lastHeal = DateTime.MinValue;

        // the watcher's own relay-and-room restart (Logic.HealRelayNow): only the engine; it never runs the later start
        // steps itself (step 6 can open TTS). (A start sequence that had stopped red at step 3 still carries on from step 4
        // once the light turns green, as ResumeIfGreen always does.)
        void HealRelay()
        {
            lastHeal = DateTime.UtcNow; watchBrokenLogins = 0;
            RefreshGame(); // (the lock again, just before the restart)
            if (IsLocked) return;
            Log.Write("the relay is healthy but this PC's logins fail (stale port forward after a WSL or Docker restart?): restarting relay and room by itself");
            Set(StepStack, new Verdict(Light.Busy, "The relay didn't let this PC in; restarting relay and room by itself."));
            if (RestartRelayRoom()) loginCache = null; // (the next tick logs in afresh)
        }

        DateTime trimCheckedAt = DateTime.MinValue;
        DateTime? trimmedAt;
        bool trimDue;

        // The 14-day log trim (LogTrim; docs/companion-app-spec.md §7.1): the stamp is read once an hour, and a due trim
        // runs on the first tick with no game on (Game is this tick's: MonitorTick refreshed it first).
        internal void MaybeTrimLogs()
        {
            if (Observe) return;
            var now = DateTime.UtcNow;
            // (trimmedAt: this run's own last trim, so a stamp that couldn't be written or a clock jump doesn't roll the
            // .old copies over again within the same 14 days)
            if ((now - trimCheckedAt).TotalMinutes >= 60) { trimCheckedAt = now; trimDue = Logic.TrimDue(LogTrim.LastTrim(L), now) && (!trimmedAt.HasValue || Logic.TrimDue(trimmedAt, now)); }
            if (!Logic.TrimNow(trimDue, Game, Observe)) return;
            RefreshGame(); // (the tick's game state can be seconds old: a game may have just started)
            if (IsLocked) return;
            trimDue = false; trimmedAt = now;
            Log.Write(LogTrim.Run(L, now));
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
                everythingStopped = true; pendingFrom = 0; stoppedAt = 0; engineStarted = false; // (the menu's stop replaces a red-light stop)
                SetPhase("Stopping");
                StopBridge();
                // (with a server: only the bridge here; the engine on the server is the host's, never stopped from here)
                if (!OnServer && dockerCli != null && Rows[StepDocker].V.Light == Light.Green) Compose(L.Friend ? "down" : "stop", 120000);
                MarkStopped(TtsRunning());
                RefreshGame(); // (the watcher pauses now, so this is the last look: it unlocks Restart engine)
                SetPhase(Logic.StoppedPhase);
                Fire();
                if (done != null) done();
            });
        }

        // (StopEverything) every row but Docker's as Stop everything leaves it: stopped, the save as it was, and TTS as it
        // is (Stop everything leaves it open: the row said "Stopped." with TTS running, 2026-11-13)
        internal void MarkStopped(bool ttsRunning)
        {
            for (int i = 0; i < Rows.Length; i++)
            {
                if (i == StepDocker) continue;
                Rows[i].V = i == StepTts ? Logic.TtsAfterStop(ttsRunning)
                    : new Verdict(Light.Grey, i == StepSave ? (L.Friend ? "Installed (unchanged)." : Rows[i].V.Text) : "Stopped.");
            }
        }
        // the menu's Stop everything is in effect (until the next start sequence): the header says Stopped
        internal bool EverythingStopped { get { return everythingStopped; } set { everythingStopped = value; } }
        // a start sequence ran (or the engine was found up); the self-test sets it for a page as it looks after a start
        internal bool EngineStarted { get { return engineStarted; } set { engineStarted = value; } }

        // the text dump for --observe --dump
        public string Dump()
        {
            var sb = new StringBuilder();
            sb.AppendLine("MTG Companion " + (Observe ? "observe" : "status") + " at " + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"));
            sb.AppendLine("Mode: " + L.Mode + ", home " + L.Home);
            if (VersionText.Length > 0) sb.AppendLine(VersionText);
            var srv = server;
            sb.AppendLine("Engine: " + (srv == null ? "this PC (Docker)" : srv.Ok ? "your server " + OwnServer.Words(srv.Server) + (srv.Server.Secure ? " (secure)" : "") : "own server, with a problem: " + srv.Problem));
            sb.AppendLine("Docker CLI: " + (dockerCli ?? "not found") + "; Docker Desktop: " + (dockerDesktop ?? "not found") + "; reads via " + (dockerViaCli ? "CLI" : "engine pipe"));
            sb.AppendLine("Phase: " + Phase);
            sb.AppendLine("Game: " + Game.Kind + ": " + Game.Text + (IsLocked ? "  [restart buttons locked]" : ""));
            for (int i = 0; i < Rows.Length; i++)
            {
                var v = Rows[i].V;
                sb.AppendLine(string.Format("  {0} {1,-14} [{2,-5}] {3}{4}", i + 1, Rows[i].Name, v.Light.ToString().ToUpperInvariant(), v.Text, v.Fix != null ? "   (button: " + v.FixLabel + (Fixes.LocksDuringGame(v.Fix) && IsLocked ? ", locked" : "") + ")" : ""));
            }
            var lc = loginCache; // (the worker drops it while Docker is down)
            if (lc != null) sb.AppendLine("Relay login: " + lc.Kind + (lc.RoomFound ? ", room " + lc.RoomStatus : ", room not listed") + (lc.Detail != null ? " (" + lc.Detail + ")" : "") + ", " + lc.Ms + " ms");
            else sb.AppendLine("Relay login: not tried (" + (IsLocked ? "locked by the game state" : "relay not ready") + ")");
            return sb.ToString();
        }
    }
}
