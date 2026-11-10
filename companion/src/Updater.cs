// Self-update, the doing (docs/companion-app-spec.md §18): the network, the files and the order of an update.
// Update.cs has the data and the pure rules; what an update does to the bridge, Docker and the save goes through
// IUpdateEffects (the Controller's steps, or FakeEffects in tests). Every file move is in update-journal.json first,
// so a kill or a power cut mid-install is finished or undone at the next start (Recover).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Threading;

namespace MtgCompanion
{
    public class Updater
    {
        public const string MutexName = @"Local\MtgTtsCompanionUpdate"; // held while files move (Apply, Recover)
        public static string TestKey;  // --test-public-key: a fake GitHub's signing key (only with a loopback --update-base)
        public string DieAt;           // --test-die-at: the test kill point (only with a loopback --update-base)
        public int Format = Updates.Format; // (--test-format, tests only)

        readonly Layout L;
        readonly string stateDir, exePath, testBase;
        readonly string token;
        readonly List<string> keys;
        readonly Dictionary<string, ReleaseInfo> releases = new Dictionary<string, ReleaseInfo>();
        public Action<string, int> Progress = (text, percent) => { };

        public Updater(Layout l, string stateDir, string exePath, string testBase)
        {
            L = l; this.stateDir = stateDir; this.exePath = exePath; this.testBase = testBase;
            token = testBase == null ? TokenStore.Load(stateDir) : null; // (a test server never gets the token)
            keys = Updates.ReleaseKeys();
            if (testBase != null && TestKey != null) keys.Add(TestKey);
            try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; } catch { } // TLS 1.2 (GitHub needs it)
        }

        string Api { get { return testBase ?? Updates.ApiBase; } }
        public string DownloadDir(string tag) { return Path.Combine(L.Home, "updates", tag); }
        object Local() { return J.Parse(Probes.ReadText(L.VersionFile)); }
        string Full(string rel) { return Path.Combine(L.Home, rel.Replace('/', '\\')); }

        void Point(string name)
        {
            if (DieAt == null || DieAt != name) return;
            Log.Write("test: killed at " + name);
            Process.GetCurrentProcess().Kill();
        }

        // ── state: the last check and a waiting update (updates.json in the state folder; state.json is the controller's)

        string StateFile { get { return Path.Combine(stateDir, "updates.json"); } }
        public object State() { return J.Parse(Probes.ReadText(StateFile)) ?? new Dictionary<string, object>(); }
        public void Remember(string key, string value)
        {
            try
            {
                var d = State() as Dictionary<string, object> ?? new Dictionary<string, object>();
                if (value == null) d.Remove(key); else d[key] = value;
                Directory.CreateDirectory(stateDir);
                File.WriteAllText(StateFile, J.Write(d), new UTF8Encoding(false));
            }
            catch { }
        }
        public bool CheckDue() { return Updates.CheckDue(J.Str(State(), "lastCheck"), DateTime.UtcNow); }

        // ── HTTP: every hop checked against the URL rule, redirects followed by hand, the token only to the API

        HttpWebResponse Open(string url, string accept, long from, out string error)
        {
            for (int hop = 0; hop < 6; hop++)
            {
                bool api;
                if (!Updates.AllowedUrl(url, testBase, out api)) { error = "refused " + Updates.HostOf(url) + ": not a GitHub address"; Log.Write("update: " + error); return null; }
                var req = (HttpWebRequest)WebRequest.Create(url);
                req.AllowAutoRedirect = false;
                req.UserAgent = Updates.UserAgent;
                req.Accept = accept;
                req.Timeout = 30000;
                req.ReadWriteTimeout = 60000;
                if (testBase != null) req.Proxy = null;
                var bearer = Updates.TokenFor(api, testBase, token);
                if (bearer != null) req.Headers["Authorization"] = "Bearer " + bearer;
                if (from > 0) req.AddRange(from);
                HttpWebResponse resp;
                try { resp = (HttpWebResponse)req.GetResponse(); }
                catch (WebException e)
                {
                    resp = e.Response as HttpWebResponse;
                    if (resp == null) { error = e.Message; return null; }
                }
                int code = (int)resp.StatusCode;
                if (code >= 300 && code < 400)
                {
                    var loc = resp.Headers["Location"];
                    resp.Close();
                    if (loc == null) { error = "a redirect with no address"; return null; }
                    url = new Uri(new Uri(url), loc).AbsoluteUri;
                    continue;
                }
                error = null;
                return resp;
            }
            error = "too many redirects";
            return null;
        }

        byte[] GetBytes(string url, string accept, out int status, out string error)
        {
            status = 0;
            using (var resp = Open(url, accept, 0, out error))
            {
                if (resp == null) return null;
                status = (int)resp.StatusCode;
                using (var s = resp.GetResponseStream()) using (var ms = new MemoryStream())
                {
                    s.CopyTo(ms);
                    return status == 200 ? ms.ToArray() : null;
                }
            }
        }

        string GetText(string url, string accept, out int status, out string error)
        {
            var b = GetBytes(url, accept, out status, out error);
            return b == null ? null : Text(b);
        }

        static string Text(byte[] b)
        {
            int skip = b.Length >= 3 && b[0] == 0xEF && b[1] == 0xBB && b[2] == 0xBF ? 3 : 0;
            return Encoding.UTF8.GetString(b, skip, b.Length - skip);
        }

        ReleaseInfo Release(string tag, out string error)
        {
            ReleaseInfo r;
            if (releases.TryGetValue(tag, out r)) { error = null; return r; }
            int status;
            var body = GetText(Api + "/repos/" + Updates.Repo + "/releases/tags/" + Uri.EscapeDataString(tag), "application/vnd.github+json", out status, out error);
            r = body == null ? null : Updates.ParseRelease(body);
            if (r == null) { error = error ?? "release " + tag + ": HTTP " + status; return null; }
            releases[tag] = r;
            return r;
        }

        // ── check

        public CheckResult Check()
        {
            var res = Run();
            Remember("lastCheck", DateTime.UtcNow.ToString("o"));
            Remember("lastResult", res.Text);
            Log.Write("update check: " + res.Text);
            return res;
        }

        // the manifest's bytes, signed by a key this app carries, then read (a bad or missing signature: never parsed)
        UpdateManifest Signed(byte[] bytes, string sig, string tag, out string error)
        {
            if (!Updates.VerifySignature(bytes, sig, keys)) { error = "The update manifest of " + tag + " isn't signed by this project's release key: not used."; return null; }
            string why;
            var m = Updates.ParseManifest(Text(bytes), out why);
            if (m == null) { error = "The update manifest of " + tag + " is broken: " + why + "."; return null; }
            if (m.Version != tag) { error = "The update manifest says " + m.Version + " but sits in release " + tag + ": not used."; return null; }
            error = null;
            return m;
        }

        CheckResult Run()
        {
            int status; string error;
            var body = GetText(Api + "/repos/" + Updates.Repo + "/releases/latest", "application/vnd.github+json", out status, out error);
            if (body == null) return new CheckResult { Failed = true, Quiet = status == 404, Text = Updates.CheckFailed(status, error) };
            var rel = Updates.ParseRelease(body);
            if (rel == null) return new CheckResult { Failed = true, Text = "Couldn't check for updates (GitHub's answer has no usable release tag)." };
            releases[rel.Tag] = rel;
            var asset = rel.Assets.FirstOrDefault(a => a.Name == Updates.ManifestAsset);
            if (asset == null) return new CheckResult { Failed = true, Release = rel, Text = "The latest release (" + rel.Tag + ") has no " + Updates.ManifestAsset + ": nothing to update from." };
            var sigAsset = rel.Assets.FirstOrDefault(a => a.Name == Updates.SignatureAsset);
            if (sigAsset == null) return new CheckResult { Failed = true, Release = rel, Text = "The update manifest of " + rel.Tag + " isn't signed (no " + Updates.SignatureAsset + "): not used." };
            var bytes = GetBytes(asset.Url, "application/octet-stream", out status, out error);
            if (bytes == null) return new CheckResult { Failed = true, Release = rel, Text = "Couldn't read the update manifest (" + (error ?? "HTTP " + status) + ")." };
            var sig = GetText(sigAsset.Url, "application/octet-stream", out status, out error);
            if (sig == null) return new CheckResult { Failed = true, Release = rel, Text = "Couldn't read the update manifest's signature (" + (error ?? "HTTP " + status) + ")." };
            var m = Signed(bytes, sig, rel.Tag, out error);
            if (m == null) return new CheckResult { Failed = true, Release = rel, Text = error };
            var plan = Updates.Plan(Local(), m, Format);
            var r = new CheckResult { Release = rel, Manifest = m, Plan = plan };
            r.Text = plan.Refused ?? (plan.UpToDate ? "Up to date (" + m.Version + ")." : Updates.Describe(plan, m));
            try
            {
                var dir = DownloadDir(m.Version);
                Directory.CreateDirectory(dir);
                File.WriteAllBytes(Path.Combine(dir, Updates.ManifestAsset), bytes);
                File.WriteAllText(Path.Combine(dir, Updates.SignatureAsset), sig, new UTF8Encoding(false));
            }
            catch { }
            return r;
        }

        // ── download

        static string Sha256Of(string file)
        {
            using (var sha = SHA256.Create()) using (var f = File.OpenRead(file))
                return string.Concat(sha.ComputeHash(f).Select(b => b.ToString("x2")));
        }

        public static bool Verified(string file, UpdatePart p)
        {
            try { return File.Exists(file) && new FileInfo(file).Length == p.Size && Sha256Of(file) == p.Sha256; } catch { return false; }
        }

        // every part of the plan into updates\<tag>\, verified; null when all are there, else why not
        public string Download(UpdateManifest m, UpdatePlan plan)
        {
            var dir = DownloadDir(m.Version);
            Directory.CreateDirectory(dir);
            foreach (var p in plan.Fetch)
            {
                var target = Path.Combine(dir, p.File);
                if (Verified(target, p)) continue;
                string error;
                var rel = Release(p.Release, out error);
                if (rel == null) return "Couldn't find release " + p.Release + " (" + error + ").";
                var asset = rel.Assets.FirstOrDefault(a => a.Name == p.File);
                if (asset == null) return "Release " + p.Release + " has no " + p.File + ".";
                error = Fetch(asset.Url, target, p);
                if (error != null) return error;
            }
            return null;
        }

        string Fetch(string url, string target, UpdatePart p)
        {
            var partial = target + ".part";
            if (File.Exists(target)) File.Delete(target);
            string error = null;
            for (int attempt = 1; attempt <= 3; attempt++)
            {
                long have = File.Exists(partial) ? new FileInfo(partial).Length : 0;
                if (have >= p.Size) { File.Delete(partial); have = 0; }
                var resp = Open(url, "application/octet-stream", have, out error);
                if (resp == null)
                {
                    if (error.StartsWith("refused")) return "The download of " + p.File + " was " + error + ". Update refused.";
                    Log.Write("update: " + p.File + " try " + attempt + ": " + error);
                    continue;
                }
                using (resp)
                {
                    int code = (int)resp.StatusCode;
                    string range = resp.Headers["Content-Range"];
                    // a 206 counts only when it starts where the partial file ends (else: the whole file again, from 0)
                    bool append = code == 206 && have > 0 && Updates.ContentRangeOk(range, have, p.Size);
                    bool whole = code == 200 || (code == 206 && have == 0 && Updates.ContentRangeOk(range, 0, p.Size));
                    if (code == 206 && !append && !whole)
                    {
                        error = "the server's range answer (" + (range ?? "none") + ") doesn't fit";
                        Log.Write("update: " + p.File + " try " + attempt + ": " + error + "; starting again from 0");
                        File.Delete(partial);
                        continue;
                    }
                    if (!append && !whole) { error = "HTTP " + code; Log.Write("update: " + p.File + " try " + attempt + ": " + error); if (code == 416) File.Delete(partial); continue; }
                    if (have > 0) Log.Write("update: " + p.File + (append ? " resumes at " + have + " bytes" : " starts again (no range answer)"));
                    try
                    {
                        using (var src = resp.GetResponseStream())
                        using (var dst = new FileStream(partial, append ? FileMode.Append : FileMode.Create, FileAccess.Write))
                        {
                            var buf = new byte[1 << 16];
                            long done = append ? have : 0; int n; var last = DateTime.MinValue;
                            while ((n = src.Read(buf, 0, buf.Length)) > 0)
                            {
                                dst.Write(buf, 0, n); done += n;
                                if (done > p.Size) break;
                                if ((DateTime.UtcNow - last).TotalSeconds >= 1) { last = DateTime.UtcNow; Progress("Downloading " + p.File + ": " + (done * 100 / p.Size) + "% of " + Updates.Mb(p.Size) + ".", (int)(done * 100 / p.Size)); }
                            }
                        }
                    }
                    catch (Exception e) { error = e.Message; Log.Write("update: " + p.File + " try " + attempt + ": " + error); continue; }
                }
                long got = new FileInfo(partial).Length;
                if (got < p.Size) { error = "the download stopped at " + got + " of " + p.Size + " bytes"; continue; }
                break;
            }
            if (!File.Exists(partial) || new FileInfo(partial).Length < p.Size) return "Couldn't download " + p.File + " (" + (error ?? "no answer") + ").";
            if (!Verified(partial, p))
            {
                File.Delete(partial);
                Log.Write("update: " + p.File + " doesn't match its sha256: deleted");
                return "The download of " + p.File + " didn't match the release's checksum, so it was deleted and the update refused.";
            }
            File.Move(partial, target);
            Log.Write("update: " + p.File + " downloaded and verified (" + Updates.Mb(p.Size) + ")");
            return null;
        }

        // ── apply

        static Mutex Acquire()
        {
            var mx = new Mutex(false, MutexName);
            try { if (mx.WaitOne(0)) return mx; }
            catch (AbandonedMutexException) { return mx; } // (the app that held it was killed: ours now)
            mx.Dispose();
            return null;
        }

        static void Free(Mutex mx) { if (mx == null) return; try { mx.ReleaseMutex(); } catch { } mx.Dispose(); }

        static string JournalPath(string home) { return Path.Combine(home, Updates.JournalFile); }

        // written whole to a temporary file, then moved over the old one (a cut never leaves half a journal)
        static void WriteJournal(string home, Journal j)
        {
            var f = JournalPath(home); var tmp = f + ".tmp";
            File.WriteAllText(tmp, J.Write(j.ToJson()), new UTF8Encoding(false));
            if (File.Exists(f)) File.Replace(tmp, f, null); else File.Move(tmp, f);
        }

        // The plan, applied from updates\<tag>\. selfArgs: what the new companion starts with after it took over.
        public ApplyResult Apply(UpdateManifest m, UpdatePlan plan, IUpdateEffects fx, string selfArgs)
        {
            var no = NotReady(m, plan);
            if (no != null) return no;
            if (fx.Locked())
            {
                Log.Write("update " + m.Version + ": deferred, a game is on");
                Remember("pending", m.Version);
                return new ApplyResult { Deferred = true, Text = "Update ready — will install after this game." };
            }
            Remember("pending", null);
            var mx = Acquire();
            if (mx == null) return new ApplyResult { Text = "Another update is being installed right now." };
            try
            {
                // An earlier update's journal (its undo couldn't finish: a held file): that one is finished first. A new
                // journal over it would lose where the old files are, and its undo would then delete what is missing.
                bool stopped = false;
                if (File.Exists(JournalPath(L.Home)))
                {
                    fx.StopBridge(); stopped = true;
                    var said = RecoverHeld(L.Home);
                    fx.Reload();
                    if (File.Exists(JournalPath(L.Home)))
                    {
                        fx.StartBridge();
                        Log.Write("update " + m.Version + ": not started, an earlier update isn't undone yet");
                        var text = "Not installing " + m.Version + ": an earlier update isn't fully undone yet. " + said;
                        Remember("lastResult", text);
                        return new ApplyResult { Text = text };
                    }
                    Log.Write("update " + m.Version + ": an earlier update was finished first (" + said + ")");
                    plan = Updates.Plan(Local(), m, Format); // (the package changed under the plan)
                    no = NotReady(m, plan);
                    if (no != null) { fx.StartBridge(); return no; }
                }
                if (plan.CompanionFirst)
                {
                    var sw = Swap(m, plan, selfArgs + " --apply-update " + m.Version);
                    if (!sw.Ok && stopped) fx.StartBridge();
                    return sw;
                }
                return ApplyFiles(m, plan, fx, selfArgs);
            }
            finally { Free(mx); }
        }

        // why this plan can't be installed now (refused, nothing to do, a download missing or changed), or null
        ApplyResult NotReady(UpdateManifest m, UpdatePlan plan)
        {
            if (plan.Refused != null) return new ApplyResult { Text = plan.Refused };
            if (plan.UpToDate) return new ApplyResult { Ok = true, Text = "Up to date (" + m.Version + ")." };
            var dir = DownloadDir(m.Version);
            foreach (var p in plan.Fetch)
                if (!Verified(Path.Combine(dir, p.File), p)) return new ApplyResult { Text = "The update isn't fully downloaded (" + p.File + "): check for updates again." };
            return null;
        }

        ApplyResult ApplyFiles(UpdateManifest m, UpdatePlan plan, IUpdateEffects fx, string selfArgs)
        {
            var dir = DownloadDir(m.Version);
            bool self = plan.Has("companion");
            var local = Local();
            var localDeployed = J.Parse(Probes.ReadText(L.DeployedFile));
            var parts = plan.Fetch.Where(p => p.Name != "companion").ToList();
            var replaced = new List<string>(); // package paths the update owns now
            foreach (var p in parts) replaced.AddRange(Updates.Holds[p.Name]);
            replaced.Add("version.json"); replaced.Add("stack/deployed.json"); // (every update writes both)
            replaced = replaced.Distinct().ToList();

            string backupRoot = Path.Combine(L.Home, "backup"), backup = Path.Combine(backupRoot, Updates.BackupName(local));
            for (int i = 2; Directory.Exists(backup); i++) backup = Path.Combine(backupRoot, Updates.BackupName(local) + "-" + i);
            var j = new Journal { Target = m.Version, Backup = backup, Replaced = replaced };
            j.Existed = replaced.Where(rel => File.Exists(Full(rel)) || Directory.Exists(Full(rel))).ToList();
            Log.Write("update " + m.Version + ": applying " + string.Join(", ", plan.Fetch.Select(p => p.Name)) + "; backup in " + backup);
            try { WriteJournal(L.Home, j); } // (before the first move)
            catch (Exception e) { return new ApplyResult { Text = "The update couldn't start: its journal can't be written (" + e.Message + "). Nothing was changed." }; }
            fx.StopBridge();
            bool imagesLoaded = false;
            try
            {
                foreach (var rel in j.Existed)
                {
                    var to = Path.Combine(backup, rel.Replace('/', '\\'));
                    Directory.CreateDirectory(Path.GetDirectoryName(to));
                    if (Directory.Exists(Full(rel))) Directory.Move(Full(rel), to); else File.Move(Full(rel), to);
                    Point("move"); // (a test kill here: moved, but not yet in the journal)
                    j.Moved.Add(rel);
                    WriteJournal(L.Home, j);
                }
                j.Phase = "placing";
                foreach (var p in parts)
                {
                    var file = Path.Combine(dir, p.File);
                    if (p.Name == "images")
                    {
                        // moved, not copied (a second 1+ GB copy on the disk for nothing); an undo moves it back
                        j.Placed.Add(new[] { "images/mtg-images.tar", file });
                        WriteJournal(L.Home, j);
                        Directory.CreateDirectory(Full("images"));
                        File.Move(file, Full("images/mtg-images.tar"));
                    }
                    else Extract(p.Name, file);
                    Point("place");
                }
                if (parts.Any(p => p.Name == "app"))
                    foreach (var k in Updates.Keep)
                    {
                        var old = Path.Combine(backup, k.Replace('/', '\\'));
                        if (File.Exists(old) && !File.Exists(Full(k))) { Directory.CreateDirectory(Path.GetDirectoryName(Full(k))); File.Copy(old, Full(k)); }
                    }
                WriteJson(Full("version.json"), VersionJson(m, local, self));
                WriteJson(Full("stack/deployed.json"), Updates.MergeDeployed(localDeployed, m.DeployedJson, plan.Has("images")));
                j.Phase = "placed";
                WriteJournal(L.Home, j);
                Point("placed");
                fx.Reload();
                if (plan.Has("images")) { imagesLoaded = true; if (!fx.LoadImages()) throw new Exception("loading the new engine images didn't work"); }
                if (plan.Has("table") && !fx.InstallSave()) throw new Exception("installing the new table didn't work");
                if (!self && !fx.StartBridge()) throw new Exception("the new bridge didn't start");
            }
            catch (Exception e)
            {
                Log.Write("update " + m.Version + " failed: " + e.Message + "; undoing it");
                bool changed = j.Moved.Count > 0 || j.Placed.Count > 0 || j.Phase != "moving";
                j.Phase = "undoing";
                try { WriteJournal(L.Home, j); } catch { }
                string undo = UndoFiles(L.Home, j);
                fx.Reload();
                if (imagesLoaded) fx.LoadImages();
                fx.StartBridge();
                Remember("lastResult", undo == null ? "Update to " + m.Version + " failed and was undone." : "Update to " + m.Version + " failed; " + undo);
                if (undo != null) return new ApplyResult { Text = "The update failed (" + e.Message + "). " + undo };
                return new ApplyResult { Text = changed ? "The update failed and was undone: " + e.Message + "." : "The update failed before anything changed: " + e.Message + "." };
            }
            try { File.Delete(JournalPath(L.Home)); } catch { }
            Prune(backupRoot);
            Log.Write("update " + m.Version + ": files in place");
            if (self)
            {
                // (the bridge loop runs from this exe, so it starts only from the new one: started here, it would
                // hold the file the swap renames. A swap that can't start means this app carries on: start it here.)
                var sw = Swap(m, plan, selfArgs);
                if (!sw.Ok) fx.StartBridge();
                return sw;
            }
            Done(m);
            return new ApplyResult { Ok = true, Text = "Updated to " + m.Version + "." };
        }

        void Done(UpdateManifest m)
        {
            try { Directory.Delete(DownloadDir(m.Version), true); } catch { }
            Remember("lastResult", "Updated to " + m.Version + ".");
            Remember("installed", m.Version);
        }

        // version.json from the release, but this app's own version stays until the new exe has taken over
        static object VersionJson(UpdateManifest m, object local, bool selfPending)
        {
            var v = new Dictionary<string, object>((Dictionary<string, object>)m.VersionJson);
            var parts = new Dictionary<string, object>(J.Get(v, "parts") as Dictionary<string, object> ?? new Dictionary<string, object>());
            if (selfPending)
            {
                var mine = Updates.LocalVersion(local, "companion");
                if (mine != null) parts["companion"] = mine; else parts.Remove("companion");
            }
            v["parts"] = parts;
            return v;
        }

        static void WriteJson(string file, object o)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(file));
            File.WriteAllText(file, J.Write(o), new UTF8Encoding(false));
        }

        void Extract(string part, string zip)
        {
            using (var z = ZipFile.OpenRead(zip))
                foreach (var e in z.Entries)
                {
                    if (e.FullName.EndsWith("/") || e.FullName.EndsWith("\\")) continue; // (a folder)
                    var rel = Updates.EntryPath(part, e.FullName);
                    if (rel == null || !Updates.Contained(L.Home, rel, part)) throw new Exception(Path.GetFileName(zip) + " holds " + e.FullName + ", which isn't the " + part + " part's");
                    var to = Full(rel);
                    Directory.CreateDirectory(Path.GetDirectoryName(to));
                    e.ExtractToFile(to, true);
                }
        }

        // Put the package back as the journal says it was. What sits in the backup is what was moved (the journal
        // can lag the last move by one): so that, not the list, decides. A sentence when something couldn't be.
        static string UndoFiles(string home, Journal j)
        {
            Func<string, string> full = rel => Path.Combine(home, rel.Replace('/', '\\'));
            Func<string, string> saved = rel => Path.Combine(j.Backup, rel.Replace('/', '\\'));
            j.Moved = j.Existed.Where(rel => File.Exists(saved(rel)) || Directory.Exists(saved(rel))).ToList();
            var u = Updates.Undo(j);
            var stuck = new List<string>();
            foreach (var pair in u.ReturnToDownload)
                try { if (File.Exists(full(pair[0])) && !File.Exists(pair[1])) { Directory.CreateDirectory(Path.GetDirectoryName(pair[1])); File.Move(full(pair[0]), pair[1]); } } catch { }
            foreach (var rel in u.Delete)
            {
                var p = full(rel);
                try { if (Directory.Exists(p)) Directory.Delete(p, true); else if (File.Exists(p)) File.Delete(p); } catch { stuck.Add(rel); }
            }
            foreach (var rel in u.MoveBack)
            {
                if (stuck.Contains(rel)) continue; // (the new one is still there)
                try
                {
                    var to = full(rel);
                    Directory.CreateDirectory(Path.GetDirectoryName(to));
                    if (Directory.Exists(saved(rel))) Directory.Move(saved(rel), to); else File.Move(saved(rel), to);
                }
                catch { stuck.Add(rel); }
            }
            if (stuck.Count == 0)
            {
                try { if (Directory.Exists(j.Backup)) Directory.Delete(j.Backup, true); } catch { }
                try { File.Delete(JournalPath(home)); } catch { }
                return null;
            }
            // (the journal stays: the next start tries again)
            Log.Write("update undo: couldn't restore " + string.Join(", ", stuck) + " (the old files are in " + j.Backup + ")");
            return "These couldn't be put back: " + string.Join(", ", stuck) + ". The old files are in " + j.Backup + "; MTG Companion tries again at its next start.";
        }

        // At the start, before the package is read: an update a kill or a power cut interrupted. Its files all in
        // place: finished (the start sequence loads, installs and starts what they need). Else: undone. Returns a
        // sentence for the window, or null when there was nothing to do.
        public static string Recover(string home)
        {
            if (home == null || !File.Exists(JournalPath(home))) return null;
            var mx = Acquire();
            if (mx == null) return null; // (an update is running in another MTG Companion)
            try { return RecoverHeld(home); }
            finally { Free(mx); }
        }

        // Recover's work, the mutex already held (the journal stays when it couldn't finish)
        static string RecoverHeld(string home)
        {
            try
            {
                var j = Journal.FromJson(J.Parse(Probes.ReadText(JournalPath(home))));
                if (j == null) { Log.Write("update journal unreadable: left as is"); return "An interrupted update left a journal that can't be read (" + JournalPath(home) + ")."; }
                if (j.Phase == "placed")
                {
                    File.Delete(JournalPath(home));
                    Log.Write("update " + j.Target + ": interrupted after its files were in place; finished");
                    return "The update to " + j.Target + " was interrupted after its files were in place; the start finishes it.";
                }
                Log.Write("update " + j.Target + ": interrupted (" + j.Phase + "); undoing it");
                var undo = UndoFiles(home, j);
                return undo == null ? "The update to " + j.Target + " was interrupted, so it was undone. Check for updates to try again." : "The update to " + j.Target + " was interrupted. " + undo;
            }
            catch (Exception e) { Log.Write("update recovery failed: " + e.Message); return "An interrupted update couldn't be undone (" + e.Message + ")."; }
        }

        // two backups; the engine images (1+ GB) only in the newest. Never the backup a journal still points at (and a
        // journal that can't be read: nothing pruned).
        void Prune(string backupRoot)
        {
            try
            {
                string live = null;
                if (File.Exists(JournalPath(L.Home)))
                {
                    var j = Journal.FromJson(J.Parse(Probes.ReadText(JournalPath(L.Home))));
                    if (j == null) return;
                    live = Path.GetFullPath(j.Backup);
                }
                var all = new DirectoryInfo(backupRoot).GetDirectories().Select(d => new KeyValuePair<string, DateTime>(d.FullName, d.CreationTimeUtc)).ToList();
                foreach (var d in Updates.BackupsToPrune(all, 2, live)) try { Directory.Delete(d, true); } catch { }
                foreach (var d in Updates.BackupsToPrune(all, 1, live))
                {
                    var img = Path.Combine(d, "images");
                    if (Directory.Exists(img)) try { Directory.Delete(img, true); } catch { }
                }
            }
            catch { }
        }

        // ── the new companion: MTG Companion.new.exe takes over (ReplaceOld in the new exe does the swap)

        public const string NewExe = "MTG Companion.new.exe", OldExe = "MTG Companion.old.exe";

        ApplyResult Swap(UpdateManifest m, UpdatePlan plan, string selfArgs)
        {
            var p = plan.Fetch.First(x => x.Name == "companion");
            var src = Path.Combine(DownloadDir(m.Version), p.File); // (verified at Apply's start)
            var next = Path.Combine(Path.GetDirectoryName(exePath), NewExe);
            try
            {
                File.Copy(src, next, true);
                using (var me = Process.GetCurrentProcess())
                {
                    var args = "--replace-old " + me.Id + " \"" + exePath + "\" --old-start " + me.StartTime.ToUniversalTime().Ticks + " --part-version " + p.Version + (selfArgs.Length > 0 ? " " + selfArgs.Trim() : "");
                    Log.Write("update " + m.Version + ": starting " + NewExe + " " + args);
                    Process.Start(new ProcessStartInfo(next, args) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(exePath) }).Dispose();
                }
            }
            catch (Exception e)
            {
                try { File.Delete(next); } catch { }
                Log.Write("update " + m.Version + ": the new companion didn't start: " + e.Message);
                return new ApplyResult { Text = "The new MTG Companion couldn't start (" + e.Message + "); this one carries on." };
            }
            if (!plan.CompanionFirst) Done(m);
            return new ApplyResult { Ok = true, Swapping = true, Text = "Updated to " + m.Version + "; the new MTG Companion takes over now." };
        }

        // In the new exe: wait for the old one (that process, by its start time: not a later one with its number),
        // rename it to .old.exe and this one to its name, record the version. Returns the path to start from, or null
        // when the swap failed (the old exe is put back); stillRunning: the old app hadn't closed after a minute.
        public static string ReplaceOld(int pid, long oldStartTicks, string oldPath, string self, string partVersion, string versionFile, out bool stillRunning)
        {
            stillRunning = false;
            try
            {
                using (var p = Process.GetProcessById(pid))
                    if (Updates.SameProcess(oldStartTicks, p.StartTime.ToUniversalTime().Ticks) && !p.WaitForExit(60000))
                    {
                        stillRunning = true;
                        Log.Write("update swap: the old companion (pid " + pid + ") is still running after 60 s");
                        return null;
                    }
            }
            catch { } // (gone already)
            if (!SwapFiles(oldPath, self, new RealFileOps())) return null;
            try
            {
                var v = J.Parse(Probes.ReadText(versionFile)) as Dictionary<string, object>;
                if (v != null && partVersion != null)
                {
                    var parts = new Dictionary<string, object>(J.Get(v, "parts") as Dictionary<string, object> ?? new Dictionary<string, object>());
                    parts["companion"] = partVersion;
                    v["parts"] = parts;
                    WriteJson(versionFile, v);
                }
            }
            catch (Exception e) { Log.Write("update swap: version.json not updated: " + e.Message); }
            Log.Write("update swap: the new companion is " + oldPath + " (the old one kept as " + OldExe + " until the next start)");
            return oldPath;
        }

        // the two renames (the old exe may stay locked for a few seconds after its process ends: 20 tries)
        public static bool SwapFiles(string oldPath, string self, IFileOps fs)
        {
            var old = Path.Combine(Path.GetDirectoryName(oldPath), OldExe);
            for (int i = 0; i < 20; i++)
            {
                try
                {
                    if (fs.Exists(old)) fs.Delete(old);
                    fs.Move(oldPath, old);
                    break;
                }
                catch (Exception e) { if (i == 19) { Log.Write("update swap: couldn't move the old exe aside: " + e.Message); return false; } fs.Sleep(500); }
            }
            try { fs.Move(self, oldPath); }
            catch (Exception e)
            {
                Log.Write("update swap: couldn't take the old exe's name: " + e.Message + "; putting the old one back");
                try { fs.Move(old, oldPath); } catch { }
                return false;
            }
            return true;
        }

        // a clean start: the previous exe and an unused new one go
        public static void CleanAfterSwap(string exePath)
        {
            var dir = Path.GetDirectoryName(exePath);
            foreach (var f in new[] { OldExe, NewExe })
            {
                var p = Path.Combine(dir, f);
                if (string.Equals(p, exePath, StringComparison.OrdinalIgnoreCase) || !File.Exists(p)) continue;
                try { File.Delete(p); Log.Write("removed " + f); } catch { }
            }
        }

        // a downloaded release (after a CompanionFirst swap, or one that waited for a game): its manifest, signed
        public UpdateManifest Downloaded(string tag, out string error)
        {
            error = null;
            if (!Updates.ValidTag(tag)) { error = "not a release name: " + tag; return null; }
            var dir = DownloadDir(tag);
            byte[] bytes = null; string sig = null;
            try { bytes = File.ReadAllBytes(Path.Combine(dir, Updates.ManifestAsset)); sig = File.ReadAllText(Path.Combine(dir, Updates.SignatureAsset)); } catch { }
            if (bytes == null || sig == null) { error = "no downloaded update " + tag; return null; }
            return Signed(bytes, sig, tag, out error);
        }

        public UpdatePlan PlanFor(UpdateManifest m) { return Updates.Plan(Local(), m, Format); }
    }
}
