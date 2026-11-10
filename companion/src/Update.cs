// Self-update from the project's GitHub releases (friend mode; docs/companion-app-spec.md §18). Updates holds the pure
// rules (--selftest), Updater the network, the files and the order of an update; what an update does to the bridge,
// Docker and the save goes through IUpdateEffects (the Controller's steps, or FakeEffects in tests).
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace MtgCompanion
{
    public class UpdatePart { public string Name, File, Sha256, Version, Release; public long Size; }

    public class UpdateManifest
    {
        public int Format, MinCompanion;
        public string Version, Built, GitCommit;
        public Dictionary<string, UpdatePart> Parts = new Dictionary<string, UpdatePart>();
        public object VersionJson, DeployedJson;
    }

    public class ReleaseAsset { public string Name, Url; public long Size; }
    public class ReleaseInfo { public string Tag; public List<ReleaseAsset> Assets = new List<ReleaseAsset>(); }

    public class UpdatePlan
    {
        public bool UpToDate, CompanionFirst;
        public string Refused; // why this release can't be applied by this app, or null
        public List<UpdatePart> Fetch = new List<UpdatePart>();
        public long Bytes { get { return Fetch.Sum(p => p.Size); } }
        public bool Has(string part) { return Fetch.Any(p => p.Name == part); }
    }

    public static class Updates
    {
        public const int Format = 1; // the manifest format this app applies (a release's minCompanion)
        public const string Repo = "Vibecoding-mods/Table-Top-Simulator-Mock-MTGA";
        public const string ApiBase = "https://api.github.com";
        public const string UserAgent = "MTG-Companion";
        public const string ManifestAsset = "update-manifest.json";
        public const string NotPublic = "Updates will work once the project is public.";
        public static readonly TimeSpan CheckEvery = TimeSpan.FromHours(6);
        // the order parts are applied in (the companion last: it restarts the app)
        public static readonly string[] PartOrder = { "app", "table", "runtime", "images", "companion" };
        // what each part replaces in the package (make-friend-package.js RELEASE_PARTS)
        public static readonly Dictionary<string, string[]> Holds = new Dictionary<string, string[]>
        {
            { "app", new[] { "bridge", "decks", "manabrew", "scenarios", "stack/compose.yml", "stack/deployed.json", "README-FRIEND.txt", "LICENSES", "version.json" } },
            { "table", new[] { "table" } },
            { "runtime", new[] { "runtime" } },
            { "images", new[] { "images" } },
        };
        static readonly string[] Hosts = { "api.github.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com" };
        static readonly Regex Tag = new Regex(@"^[\w.-]{1,100}$"), FileName = new Regex(@"^[\w.-]{1,100}$"), Sha = new Regex("^[0-9a-f]{64}$");

        public static string ImagesVersion(string node, string relay) { return Logic.Sha8(Encoding.UTF8.GetBytes(node + relay)); }

        // update-manifest.json, checked: tags and file names plain, every part with a sha256 and a size
        public static UpdateManifest ParseManifest(string text, out string error)
        {
            error = null;
            var o = J.Parse(text);
            if (!(o is Dictionary<string, object>)) { error = "the update manifest isn't JSON"; return null; }
            var m = new UpdateManifest { Format = J.Int(o, "format"), MinCompanion = J.Int(o, "minCompanion"), Version = J.Str(o, "version"), Built = J.Str(o, "built"), GitCommit = J.Str(o, "gitCommit"), VersionJson = J.Get(o, "versionJson"), DeployedJson = J.Get(o, "deployedJson") };
            if (m.Format < 1) { error = "the update manifest has no format"; return null; }
            if (m.Version == null || !Tag.IsMatch(m.Version)) { error = "the update manifest has no usable version"; return null; }
            if (!(m.VersionJson is Dictionary<string, object>) || !(m.DeployedJson is Dictionary<string, object>)) { error = "the update manifest lacks version.json or deployed.json"; return null; }
            var parts = J.Get(o, "parts") as Dictionary<string, object>;
            if (parts == null || parts.Count == 0) { error = "the update manifest lists no parts"; return null; }
            foreach (var kv in parts)
            {
                if (!PartOrder.Contains(kv.Key)) continue; // (a part this app doesn't know: a newer release; minCompanion says whether that matters)
                var p = new UpdatePart { Name = kv.Key, File = J.Str(kv.Value, "file"), Sha256 = (J.Str(kv.Value, "sha256") ?? "").ToLowerInvariant(), Version = J.Str(kv.Value, "version"), Release = J.Str(kv.Value, "release") ?? m.Version };
                long size; long.TryParse(J.Str(kv.Value, "size") ?? "", out size); p.Size = size;
                if (p.File == null || !FileName.IsMatch(p.File) || p.File.Trim('.').Length == 0) { error = "the " + kv.Key + " part has no plain file name"; return null; }
                if (!Sha.IsMatch(p.Sha256)) { error = "the " + kv.Key + " part has no sha256"; return null; }
                if (p.Size <= 0) { error = "the " + kv.Key + " part has no size"; return null; }
                if (string.IsNullOrEmpty(p.Version)) { error = "the " + kv.Key + " part has no version"; return null; }
                if (!Tag.IsMatch(p.Release)) { error = "the " + kv.Key + " part names no usable release"; return null; }
                m.Parts[kv.Key] = p;
            }
            return m;
        }

        // The version of a part this package has: version.json parts, else what older packages already say
        public static string LocalVersion(object v, string part)
        {
            var s = J.Str(J.Get(v, "parts"), part);
            if (s != null) return s;
            switch (part)
            {
                case "table": return J.Str(v, "save");
                case "runtime": return J.Str(v, "nodeVersion");
                case "images":
                    string n = J.Str(v, "node"), r = J.Str(v, "relay");
                    return n != null && r != null ? ImagesVersion(n, r) : null;
                default: return null; // (app, companion: unknown, so changed)
            }
        }

        public static UpdatePlan Plan(object local, UpdateManifest m, int format)
        {
            var p = new UpdatePlan();
            foreach (var k in PartOrder)
            {
                UpdatePart part;
                if (m.Parts.TryGetValue(k, out part) && LocalVersion(local, k) != part.Version) p.Fetch.Add(part);
            }
            p.UpToDate = p.Fetch.Count == 0;
            if (m.MinCompanion > format)
            {
                // this app can't apply it: the new companion goes first and applies the rest
                if (!p.Has("companion")) p.Refused = "This release needs a newer MTG Companion than it carries. Download the full package again.";
                else p.CompanionFirst = true;
                p.UpToDate = false;
            }
            return p;
        }

        // Whether a URL may be fetched, and whether it is the API (the only host a token goes to). testBase: --update-base,
        // the fake GitHub (its own host plays api.github.com, http://localhost on its port the asset host).
        public static bool AllowedUrl(string url, string testBase, out bool api)
        {
            api = false;
            Uri u;
            if (url == null || !Uri.TryCreate(url, UriKind.Absolute, out u) || u.UserInfo.Length > 0) return false;
            if (testBase != null)
            {
                var b = new Uri(testBase);
                if (u.Scheme == b.Scheme && u.Host == b.Host && u.Port == b.Port) { api = true; return true; }
                return u.Scheme == Uri.UriSchemeHttp && u.Host == "localhost" && u.Port == b.Port;
            }
            if (u.Scheme != Uri.UriSchemeHttps || !u.IsDefaultPort) return false;
            string host = u.Host.ToLowerInvariant();
            if (!Hosts.Contains(host)) return false;
            api = host == "api.github.com";
            return true;
        }

        public static string HostOf(string url) { Uri u; return Uri.TryCreate(url ?? "", UriKind.Absolute, out u) ? u.Host : "?"; }

        // a release from GET .../releases/latest or .../releases/tags/<tag>
        public static ReleaseInfo ParseRelease(string body)
        {
            var o = J.Parse(body);
            var tag = J.Str(o, "tag_name");
            if (tag == null || !Tag.IsMatch(tag)) return null;
            var r = new ReleaseInfo { Tag = tag };
            foreach (var a in J.Arr(o, "assets") ?? new object[0])
            {
                long size; long.TryParse(J.Str(a, "size") ?? "", out size);
                r.Assets.Add(new ReleaseAsset { Name = J.Str(a, "name"), Url = J.Str(a, "url"), Size = size });
            }
            return r;
        }

        // what a failed releases/latest says (never a red light)
        public static string CheckFailed(int status, string error)
        {
            if (status == 404) return NotPublic;
            if (status == 401 || status == 403) return "Couldn't check for updates: GitHub refused (HTTP " + status + "; a saved token may be wrong or expired, or too many checks this hour).";
            return "Couldn't check for updates (" + (status > 0 ? "HTTP " + status : error ?? "no answer") + ").";
        }

        public static bool CheckDue(string lastCheckIso, DateTime nowUtc)
        {
            DateTime last;
            if (lastCheckIso == null || !DateTime.TryParse(lastCheckIso, null, System.Globalization.DateTimeStyles.RoundtripKind, out last)) return true;
            var since = nowUtc - last.ToUniversalTime();
            return since >= CheckEvery || since < TimeSpan.Zero; // (a clock set back: check)
        }

        // backup folders to delete: all but the newest `keep`
        public static List<string> BackupsToPrune(IEnumerable<KeyValuePair<string, DateTime>> backups, int keep)
        {
            return backups.OrderByDescending(b => b.Value).Skip(keep).Select(b => b.Key).ToList();
        }

        // A zip entry's path inside the package, or null: under one of the part's folders or files, and never outside
        public static string EntryPath(string part, string entry)
        {
            string[] holds;
            if (entry == null || !Holds.TryGetValue(part, out holds)) return null;
            var e = entry.Replace('\\', '/');
            if (e.StartsWith("/") || e.Contains(":")) return null;
            var segs = e.Split('/').Where(s => s.Length > 0).ToArray();
            if (segs.Length == 0 || segs.Any(s => s == ".." || s == ".")) return null;
            var rel = string.Join("/", segs);
            foreach (var h in holds) if (rel == h || rel.StartsWith(h + "/")) return rel;
            return null;
        }

        // a folder name for the backup of this version
        public static string BackupName(object local)
        {
            var v = J.Str(local, "release") ?? ("built-" + (J.Str(local, "built") ?? "unknown"));
            return Regex.Replace(v.Length > 40 ? v.Substring(0, 40) : v, @"[^\w.-]", "-");
        }

        public static string Mb(long bytes) { return (bytes / 1048576.0).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + " MB"; }

        public static string Describe(UpdatePlan p, UpdateManifest m)
        {
            var names = p.Fetch.Select(x => x.Name == "app" ? "bridge and decks" : x.Name == "images" ? "engine" : x.Name == "companion" ? "this app" : x.Name);
            return "Update available: " + m.Version + " (" + string.Join(", ", names) + "; " + Mb(p.Bytes) + " to download).";
        }
    }

    // What an update does outside its own files
    public interface IUpdateEffects
    {
        bool Locked();              // a game on (or can't tell): don't touch anything
        void StopBridge();
        void Reload();              // the package's files changed: read version.json and deployed.json again
        bool LoadImages();          // docker load the package's images\ tar, then compose up -d
        bool InstallSave();         // the hash-guarded save install
        bool StartBridge();         // start it and wait until /versions answers
    }

    // Tests: each step written to a file instead of done; --fake-fail <step> makes that step fail
    public class FakeEffects : IUpdateEffects
    {
        readonly string file; readonly HashSet<string> fail; readonly Func<bool> locked;
        public FakeEffects(string file, IEnumerable<string> fail, Func<bool> locked) { this.file = file; this.fail = new HashSet<string>(fail); this.locked = locked; }
        bool Step(string name) { File.AppendAllText(file, name + Environment.NewLine); return !fail.Contains(name); }
        public bool Locked() { return locked(); }
        public void StopBridge() { Step("stop-bridge"); }
        public void Reload() { Step("reload"); }
        public bool LoadImages() { return Step("load-images"); }
        public bool InstallSave() { return Step("install-save"); }
        public bool StartBridge() { return Step("start-bridge"); }
    }

    // The GitHub token, if the user gave one: DPAPI (this Windows user) in the state folder
    public static class TokenStore
    {
        static string FileOf(string stateDir) { return Path.Combine(stateDir, "github-token.bin"); }
        static readonly byte[] Salt = Encoding.UTF8.GetBytes("MTG Companion github token");
        public static string Load(string stateDir)
        {
            try
            {
                var f = FileOf(stateDir);
                if (!File.Exists(f)) return null;
                var t = Encoding.UTF8.GetString(ProtectedData.Unprotect(File.ReadAllBytes(f), Salt, DataProtectionScope.CurrentUser)).Trim();
                return t.Length > 0 ? t : null;
            }
            catch { return null; }
        }
        public static void Save(string stateDir, string token)
        {
            var f = FileOf(stateDir);
            if (string.IsNullOrWhiteSpace(token)) { if (File.Exists(f)) File.Delete(f); return; }
            Directory.CreateDirectory(stateDir);
            File.WriteAllBytes(f, ProtectedData.Protect(Encoding.UTF8.GetBytes(token.Trim()), Salt, DataProtectionScope.CurrentUser));
        }
    }

    public class CheckResult
    {
        public bool Failed, Quiet;
        public string Text;
        public UpdateManifest Manifest;
        public ReleaseInfo Release;
        public UpdatePlan Plan;
        public bool Available { get { return Plan != null && !Plan.UpToDate && Plan.Refused == null; } }
    }

    public class ApplyResult { public bool Ok, Deferred, Swapping; public string Text; }

    // Where the self-update stands, as one snapshot (the window, the tray and the status page read it; nothing else is
    // kept elsewhere). Status: idle, checking, up-to-date, not-public, available, downloading, ready (waits for the
    // game to end), installing, restarting (the new app takes over), updated, failed.
    public class UpdateState
    {
        public string Status = "idle";
        public string Current;              // this package's version ("v2026.11.10-1432", or "built 2026-11-09")
        public string Available;            // the release offered, or null
        public string Notes;                // what it changes and how much to download
        public int Progress = -1;           // 0-100 while downloading, else -1
        public bool DeferredUntilGameEnds;
        public bool Later;                  // the player pressed Later for Available
        public string Error;                // the last failure, in words
        public string LastCheck;            // ISO time of the last check
        public string Text = "";            // the one line for the window and the tray
        public UpdateState Copy() { return (UpdateState)MemberwiseClone(); }

        // after a check. laterSame: Later was pressed for this same release
        public void Checked(CheckResult r, bool laterSame, DateTime nowUtc)
        {
            LastCheck = nowUtc.ToString("o");
            Text = r.Text;
            Status = r.Available ? "available" : r.Quiet ? "not-public" : r.Failed || (r.Plan != null && r.Plan.Refused != null) ? "failed" : "up-to-date";
            Error = Status == "failed" ? r.Text : null;
            Available = r.Available ? r.Manifest.Version : null;
            Notes = r.Available ? r.Text : null;
            Later = r.Available && laterSame;
            Progress = -1;
        }

        // after an install (or its refusal until the game ends)
        public void Applied(ApplyResult res)
        {
            Text = res.Text;
            Status = res.Deferred ? "ready" : res.Swapping ? "restarting" : res.Ok ? "updated" : "failed";
            DeferredUntilGameEnds = res.Deferred;
            Error = res.Ok || res.Deferred ? null : res.Text;
            Progress = -1;
            if (res.Ok && !res.Swapping) { Available = null; Notes = null; }
        }
    }

    public class Updater
    {
        readonly Layout L;
        readonly string stateDir, exePath, testBase;
        readonly string token;
        readonly Dictionary<string, ReleaseInfo> releases = new Dictionary<string, ReleaseInfo>();
        public Action<string, int> Progress = (text, percent) => { };

        public Updater(Layout l, string stateDir, string exePath, string testBase)
        {
            L = l; this.stateDir = stateDir; this.exePath = exePath; this.testBase = testBase;
            token = TokenStore.Load(stateDir);
            try { ServicePointManager.SecurityProtocol |= (SecurityProtocolType)3072; } catch { } // TLS 1.2 (GitHub needs it)
        }

        string Api { get { return testBase ?? Updates.ApiBase; } }
        public string DownloadDir(string tag) { return Path.Combine(L.Home, "updates", tag); }
        object Local() { return J.Parse(Probes.ReadText(L.VersionFile)); }

        // ── state: the last check (updates.json in the state folder; state.json is the controller's)

        string StateFile { get { return Path.Combine(stateDir, "updates.json"); } }
        public object State() { return J.Parse(Probes.ReadText(StateFile)) ?? new Dictionary<string, object>(); }
        void Remember(string key, string value)
        {
            try
            {
                var d = State() as Dictionary<string, object> ?? new Dictionary<string, object>();
                d[key] = value;
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
                if (api && token != null) req.Headers["Authorization"] = "Bearer " + token;
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

        string GetText(string url, string accept, out int status, out string error)
        {
            status = 0;
            using (var resp = Open(url, accept, 0, out error))
            {
                if (resp == null) return null;
                status = (int)resp.StatusCode;
                using (var rd = new StreamReader(resp.GetResponseStream(), Encoding.UTF8)) { var body = rd.ReadToEnd(); return status == 200 ? body : null; }
            }
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

        CheckResult Run()
        {
            int status; string error;
            var body = GetText(Api + "/repos/" + Updates.Repo + "/releases/latest", "application/vnd.github+json", out status, out error);
            if (body == null) return new CheckResult { Failed = true, Quiet = status == 404, Text = Updates.CheckFailed(status, error) };
            var rel = Updates.ParseRelease(body);
            if (rel == null) return new CheckResult { Failed = true, Text = "Couldn't check for updates (GitHub's answer has no release tag)." };
            releases[rel.Tag] = rel;
            var asset = rel.Assets.FirstOrDefault(a => a.Name == Updates.ManifestAsset);
            if (asset == null) return new CheckResult { Failed = true, Release = rel, Text = "The latest release (" + rel.Tag + ") has no " + Updates.ManifestAsset + ": nothing to update from." };
            var text = GetText(asset.Url, "application/octet-stream", out status, out error);
            if (text == null) return new CheckResult { Failed = true, Release = rel, Text = "Couldn't read the update manifest (" + (error ?? "HTTP " + status) + ")." };
            var m = Updates.ParseManifest(text, out error);
            if (m == null) return new CheckResult { Failed = true, Release = rel, Text = "The update manifest of " + rel.Tag + " is broken: " + error + "." };
            if (m.Version != rel.Tag) return new CheckResult { Failed = true, Release = rel, Text = "The update manifest says " + m.Version + " but sits in release " + rel.Tag + ": not used." };
            var plan = Updates.Plan(Local(), m, Updates.Format);
            var r = new CheckResult { Release = rel, Manifest = m, Plan = plan };
            r.Text = plan.Refused ?? (plan.UpToDate ? "Up to date (" + m.Version + ")." : Updates.Describe(plan, m));
            try { Directory.CreateDirectory(DownloadDir(m.Version)); File.WriteAllText(Path.Combine(DownloadDir(m.Version), Updates.ManifestAsset), text, new UTF8Encoding(false)); } catch { }
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
                    bool append = code == 206 && have > 0;
                    if (code != 200 && !append) { error = "HTTP " + code; Log.Write("update: " + p.File + " try " + attempt + ": " + error); if (code == 416) File.Delete(partial); continue; }
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

        // The plan, applied from updates\<tag>\. selfArgs: what the new companion starts with after it took over.
        public ApplyResult Apply(UpdateManifest m, UpdatePlan plan, IUpdateEffects fx, string selfArgs)
        {
            if (plan.Refused != null) return new ApplyResult { Text = plan.Refused };
            if (plan.UpToDate) return new ApplyResult { Ok = true, Text = "Up to date (" + m.Version + ")." };
            var dir = DownloadDir(m.Version);
            foreach (var p in plan.Fetch)
                if (!Verified(Path.Combine(dir, p.File), p)) return new ApplyResult { Text = "The update isn't fully downloaded (" + p.File + "): check for updates again." };
            if (fx.Locked()) { Log.Write("update " + m.Version + ": deferred, a game is on"); return new ApplyResult { Deferred = true, Text = "Update ready — will install after this game." }; }

            bool self = plan.Has("companion");
            if (plan.CompanionFirst) return Swap(m, plan, selfArgs + " --apply-update " + m.Version);

            var local = Local();
            var parts = plan.Fetch.Where(p => p.Name != "companion").ToList();
            var replaced = new List<string>(); // package paths the update owns now
            foreach (var p in parts) replaced.AddRange(Updates.Holds[p.Name]);
            foreach (var f in new[] { "version.json", "stack/deployed.json" }) if (!replaced.Contains(f)) replaced.Add(f);
            replaced = replaced.Distinct().ToList();

            string backupRoot = Path.Combine(L.Home, "backup"), backup = Path.Combine(backupRoot, Updates.BackupName(local));
            for (int i = 2; Directory.Exists(backup); i++) backup = Path.Combine(backupRoot, Updates.BackupName(local) + "-" + i);
            Log.Write("update " + m.Version + ": applying " + string.Join(", ", plan.Fetch.Select(p => p.Name)) + "; backup in " + backup);
            fx.StopBridge();
            var moved = new List<string>();
            bool imagesLoaded = false;
            try
            {
                foreach (var rel in replaced)
                {
                    var from = Path.Combine(L.Home, rel.Replace('/', '\\'));
                    var to = Path.Combine(backup, rel.Replace('/', '\\'));
                    if (!File.Exists(from) && !Directory.Exists(from)) continue;
                    Directory.CreateDirectory(Path.GetDirectoryName(to));
                    if (Directory.Exists(from)) Directory.Move(from, to); else File.Move(from, to);
                    moved.Add(rel);
                }
                foreach (var p in parts)
                {
                    var file = Path.Combine(dir, p.File);
                    if (p.Name == "images")
                    {
                        Directory.CreateDirectory(Path.Combine(L.Home, "images"));
                        File.Copy(file, Path.Combine(L.Home, "images", "mtg-images.tar"), true);
                    }
                    else Extract(p.Name, file);
                }
                WriteJson(Path.Combine(L.Home, "version.json"), VersionJson(m, local, self));
                WriteJson(Path.Combine(L.Home, "stack", "deployed.json"), m.DeployedJson);
                fx.Reload();
                if (plan.Has("images")) { imagesLoaded = true; if (!fx.LoadImages()) throw new Exception("loading the new engine images didn't work"); }
                if (plan.Has("table") && !fx.InstallSave()) throw new Exception("installing the new table didn't work");
                if (!self && !fx.StartBridge()) throw new Exception("the new bridge didn't start");
            }
            catch (Exception e)
            {
                Log.Write("update " + m.Version + " failed: " + e.Message + "; undoing it");
                string undo = Undo(replaced, moved, backup);
                fx.Reload();
                if (imagesLoaded) fx.LoadImages();
                fx.StartBridge();
                Remember("lastResult", "Update to " + m.Version + " failed and was undone.");
                return new ApplyResult { Text = "The update failed and was undone: " + e.Message + "." + (undo != null ? " " + undo : "") };
            }
            Prune(backupRoot);
            Log.Write("update " + m.Version + ": files in place");
            if (self) return Swap(m, plan, selfArgs);
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
                    if (rel == null) throw new Exception(Path.GetFileName(zip) + " holds " + e.FullName + ", which isn't the " + part + " part's");
                    var to = Path.Combine(L.Home, rel.Replace('/', '\\'));
                    Directory.CreateDirectory(Path.GetDirectoryName(to));
                    e.ExtractToFile(to, true);
                }
        }

        // put the backup back; a sentence when something couldn't be
        string Undo(List<string> replaced, List<string> moved, string backup)
        {
            var stuck = new List<string>();
            foreach (var rel in replaced)
            {
                var p = Path.Combine(L.Home, rel.Replace('/', '\\'));
                try { if (Directory.Exists(p)) Directory.Delete(p, true); else if (File.Exists(p)) File.Delete(p); } catch { stuck.Add(rel); }
            }
            foreach (var rel in moved)
            {
                try
                {
                    var from = Path.Combine(backup, rel.Replace('/', '\\'));
                    var to = Path.Combine(L.Home, rel.Replace('/', '\\'));
                    Directory.CreateDirectory(Path.GetDirectoryName(to));
                    if (Directory.Exists(from)) Directory.Move(from, to); else File.Move(from, to);
                }
                catch { stuck.Add(rel); }
            }
            if (stuck.Count == 0) { try { Directory.Delete(backup, true); } catch { } return null; }
            Log.Write("update undo: couldn't restore " + string.Join(", ", stuck) + " (the old files are in " + backup + ")");
            return "Some files couldn't be put back (" + string.Join(", ", stuck) + "); the old ones are in " + backup + ".";
        }

        void Prune(string backupRoot)
        {
            try
            {
                var all = new DirectoryInfo(backupRoot).GetDirectories().Select(d => new KeyValuePair<string, DateTime>(d.FullName, d.CreationTimeUtc));
                foreach (var d in Updates.BackupsToPrune(all, 2)) try { Directory.Delete(d, true); } catch { }
            }
            catch { }
        }

        // ── the new companion: MTG Companion.new.exe takes over (Program.ReplaceOld does the swap)

        public const string NewExe = "MTG Companion.new.exe", OldExe = "MTG Companion.old.exe";

        ApplyResult Swap(UpdateManifest m, UpdatePlan plan, string selfArgs)
        {
            var p = plan.Fetch.First(x => x.Name == "companion");
            var src = Path.Combine(DownloadDir(m.Version), p.File);
            var next = Path.Combine(Path.GetDirectoryName(exePath), NewExe);
            try
            {
                File.Copy(src, next, true);
                if (!Verified(next, p)) throw new Exception("the copy doesn't match its checksum");
                var args = "--replace-old " + Process.GetCurrentProcess().Id + " \"" + exePath + "\" --part-version " + p.Version + (selfArgs.Length > 0 ? " " + selfArgs.Trim() : "");
                Log.Write("update " + m.Version + ": starting " + NewExe + " " + args);
                Process.Start(new ProcessStartInfo(next, args) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(exePath) }).Dispose();
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

        // In the new exe: wait for the old one, rename it to .old.exe and this one to its name, record the version.
        // Returns the path to start from, or null when the swap failed (the old exe is put back).
        public static string ReplaceOld(int pid, string oldPath, string self, string partVersion, string versionFile)
        {
            try { using (var p = Process.GetProcessById(pid)) p.WaitForExit(60000); } catch { } // (gone already)
            var old = Path.Combine(Path.GetDirectoryName(oldPath), OldExe);
            for (int i = 0; i < 20; i++)
            {
                try
                {
                    if (File.Exists(old)) File.Delete(old);
                    File.Move(oldPath, old);
                    break;
                }
                catch (Exception e) { if (i == 19) { Log.Write("update swap: couldn't move the old exe aside: " + e.Message); return null; } System.Threading.Thread.Sleep(500); }
            }
            try { File.Move(self, oldPath); }
            catch (Exception e)
            {
                Log.Write("update swap: couldn't take the old exe's name: " + e.Message + "; putting the old one back");
                try { File.Move(old, oldPath); } catch { }
                return null;
            }
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

        // after a CompanionFirst swap: the rest of that release, from its download folder
        public UpdateManifest Downloaded(string tag, out string error)
        {
            error = null;
            var text = Probes.ReadText(Path.Combine(DownloadDir(tag), Updates.ManifestAsset));
            if (text == null) { error = "no downloaded update " + tag; return null; }
            return Updates.ParseManifest(text, out error);
        }

        public UpdatePlan PlanFor(UpdateManifest m) { return Updates.Plan(Local(), m, Updates.Format); }
    }
}
