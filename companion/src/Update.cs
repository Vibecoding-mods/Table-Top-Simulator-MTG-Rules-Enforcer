// Self-update from the project's GitHub releases (friend mode; docs/companion-app-spec.md §11): the data, the state
// snapshot and the pure rules (--selftest). Updater.cs has the network, the files and the order of an update.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
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
    // WhatsNew: the release notes' "What's new" items, as plain text (Updates.WhatsNew)
    public class ReleaseInfo { public string Tag; public List<ReleaseAsset> Assets = new List<ReleaseAsset>(); public List<string> WhatsNew = new List<string>(); }

    public class UpdatePlan
    {
        public bool UpToDate, CompanionFirst;
        public string Refused; // why this release can't be applied by this app, or null
        public List<UpdatePart> Fetch = new List<UpdatePart>();
        public long Bytes { get { return Fetch.Sum(p => p.Size); } }
        public bool Has(string part) { return Fetch.Any(p => p.Name == part); }
    }

    public class CheckResult
    {
        public bool Failed, Quiet;
        public bool Skipped;  // the automatic check found the release the player went back from (Revert): not offered
        public string Text;
        public UpdateManifest Manifest;
        public ReleaseInfo Release;
        public UpdatePlan Plan;
        public bool Available { get { return Plan != null && !Plan.UpToDate && Plan.Refused == null && !Skipped; } }
    }

    public class ApplyResult { public bool Ok, Deferred, Swapping; public string Text; }

    // What Revert would go back to: the newest backup\<old version>\ (docs/companion-app-spec.md §11.6). Possible
    // false: Why says why not (no backup yet, or one that lacks a part it would need). Self: the backup holds this
    // app's own exe of that version, which then takes over the way an update's new exe does. Changes: what goes back
    // ("table", "app", "engine"), in the order the check line names them.
    public class RevertInfo
    {
        public bool Possible, Self;
        public string Backup, Target, From, Why, CompanionVersion;
        public List<string> Changes = new List<string>();
    }

    // An update in progress, on disk before the first file moves (update-journal.json in the package): what a start
    // after a kill or a power cut needs to put the package back. Existed: the paths that were there before;
    // Moved: those now in Backup; Placed: files moved in from the download folder ({ package path, download path }).
    public class Journal
    {
        public string Target, Backup, Phase = "moving";
        public string Kind = "update", Source; // Kind "revert": Backup holds the newer files, Source is the backup they came back from
        public List<string> Replaced = new List<string>(), Existed = new List<string>(), Moved = new List<string>();
        public List<string[]> Placed = new List<string[]>();

        public object ToJson()
        {
            return new Dictionary<string, object> { { "kind", Kind }, { "source", Source }, { "target", Target }, { "backup", Backup }, { "phase", Phase }, { "replaced", Replaced.ToArray() },
                { "existed", Existed.ToArray() }, { "moved", Moved.ToArray() }, { "placed", Placed.Select(p => (object)p).ToArray() } };
        }

        public static Journal FromJson(object o)
        {
            if (!(o is Dictionary<string, object>)) return null;
            Func<string, List<string>> list = k => (J.Arr(o, k) ?? new object[0]).Select(x => Convert.ToString(x)).Where(x => x != null).ToList();
            var j = new Journal { Kind = J.Str(o, "kind") ?? "update", Source = J.Str(o, "source"), Target = J.Str(o, "target"), Backup = J.Str(o, "backup"), Phase = J.Str(o, "phase") ?? "moving", Replaced = list("replaced"), Existed = list("existed"), Moved = list("moved") };
            foreach (var p in J.Arr(o, "placed") ?? new object[0])
            {
                var a = p as object[] ?? (p is System.Collections.ArrayList ? ((System.Collections.ArrayList)p).ToArray() : null);
                if (a != null && a.Length == 2) j.Placed.Add(new[] { Convert.ToString(a[0]), Convert.ToString(a[1]) });
            }
            if (j.Backup == null || (j.Kind == "revert" && j.Source == null)) return null;
            return j;
        }
    }

    // Undoing a journal: what to delete (only what the update moved away or created: never a path that was there and
    // stayed), what goes back from the backup, and what goes back to the download folder
    public class UndoPlan { public List<string> Delete = new List<string>(), MoveBack = new List<string>(); public List<string[]> ReturnToDownload = new List<string[]>(); }

    // Where the self-update stands, as one snapshot (the window, the tray and the status page read it; nothing else is
    // kept elsewhere). Status: idle, checking, up-to-date, not-public, skipped (the automatic check found the release
    // Revert went back from), available, downloading, ready (waits for the game to end), installing, restarting (the
    // new app takes over), updated, failed, interrupted; and for Revert: reverting, revert-ready (waits for the game
    // to end), reverted.
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
        public List<string> Changes;        // what the offered release changes: "table", "app", "engine" (Updates.Changes)
        public List<string> WhatsNew;       // the offered release's "What's new" items (its notes on GitHub), or null
        public RevertInfo Revert;           // what Revert would go back to (the Controller's, after each change of the package)
        public bool RevertWaiting;          // Revert was pressed during a game: it goes back after the game (the one place this is kept: Controller.PendingRevert reads it; a check changes Status, never this)
        public UpdateState Copy() { return (UpdateState)MemberwiseClone(); }

        // after a check. laterSame: Later was pressed for this same release
        public void Checked(CheckResult r, bool laterSame, DateTime nowUtc)
        {
            LastCheck = nowUtc.ToString("o");
            Text = r.Text;
            Status = r.Available ? "available" : r.Quiet ? "not-public" : r.Failed || (r.Plan != null && r.Plan.Refused != null) ? "failed" : "up-to-date";
            Error = Status == "failed" ? r.Text : null;
            if (r.Skipped) Status = "skipped";
            Available = r.Available ? r.Manifest.Version : null;
            Notes = r.Available ? r.Text : null;
            Changes = r.Available ? Updates.Changes(r.Plan.Fetch.Select(p => p.Name)) : null;
            WhatsNew = r.Available && r.Release != null && r.Release.WhatsNew.Count > 0 ? r.Release.WhatsNew : null;
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
            if (res.Ok && !res.Swapping) { Available = null; Notes = null; Changes = null; WhatsNew = null; }
        }

        // after a revert (or its wait for the game). One that went back clears any offer: it was planned against the
        // newer package.
        public void Reverted(ApplyResult res)
        {
            Text = res.Text;
            Status = res.Deferred ? "revert-ready" : res.Swapping ? "restarting" : res.Ok ? "reverted" : "failed";
            RevertWaiting = res.Deferred;
            Error = res.Ok || res.Deferred ? null : res.Text;
            Progress = -1;
            if (res.Ok) { Available = null; Notes = null; Changes = null; WhatsNew = null; Later = false; }
        }
    }

    public static class Updates
    {
        public const int Format = 2; // the manifest format this app applies (a release's minCompanion; 2: the table is made
                                     // from the host's Workshop copy, the table part is the patcher)
        public const string Repo = "Vibecoding-mods/Table-Top-Simulator-MTG-Rules-Enforcer";
        public const string ApiBase = "https://api.github.com";
        public const string UserAgent = "MTG-Companion";
        public const string ManifestAsset = "update-manifest.json", SignatureAsset = "update-manifest.json.sig";
        public const string JournalFile = "update-journal.json";
        public const string NotPublic = "Updates will work once the project is public.";
        public static readonly TimeSpan CheckEvery = TimeSpan.FromHours(6);
        public static readonly TimeSpan IdleBeforeInstall = TimeSpan.FromMinutes(2); // (a deferred update after a game)
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
        // what an app update carries over from the old files (the friend's card picture cache; not in app.zip)
        public static readonly string[] Keep = { "bridge/image-cache-klrmngr.json" };
        static readonly string[] Hosts = { "api.github.com", "github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com" };
        static readonly Regex TagRe = new Regex(@"^[\w.-]{1,100}$"), FileName = new Regex(@"^[\w.-]{1,100}$"), Sha = new Regex("^[0-9a-f]{64}$");

        // a release tag or file name: word characters, dots and dashes, and never only dots ("." and ".." are paths)
        public static bool ValidTag(string tag) { return tag != null && TagRe.IsMatch(tag) && tag.Trim('.').Length > 0; }
        static bool ValidFile(string f) { return f != null && FileName.IsMatch(f) && f.Trim('.').Length > 0; }

        public static string ImagesVersion(string node, string relay) { return Logic.Sha8(Encoding.UTF8.GetBytes(node + relay)); }

        // ── the signature: ECDSA P-256 over the manifest's bytes, IEEE P1363 (r || s, 64 bytes), base64 in the .sig asset

        // the public keys this app trusts: companion\release-keys.txt, built in (base64 of X || Y, one per line; during a
        // key change the next exe carries both)
        public static List<string> ReleaseKeys()
        {
            var keys = new List<string>();
            try
            {
                using (var s = Assembly.GetExecutingAssembly().GetManifestResourceStream("release-keys.txt"))
                    if (s != null) using (var r = new StreamReader(s)) keys.AddRange(ParseKeys(r.ReadToEnd()));
            }
            catch { }
            return keys;
        }

        public static IEnumerable<string> ParseKeys(string text)
        {
            return (text ?? "").Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0 && !l.StartsWith("#"));
        }

        public static bool VerifySignature(byte[] data, string sigText, IEnumerable<string> keys)
        {
            byte[] sig;
            try { sig = Convert.FromBase64String((sigText ?? "").Trim()); } catch { return false; }
            if (data == null || sig.Length != 64) return false;
            foreach (var k in keys)
            {
                try
                {
                    var xy = Convert.FromBase64String(k);
                    if (xy.Length != 64) continue;
                    var blob = new byte[72];
                    BitConverter.GetBytes(0x31534345).CopyTo(blob, 0); // BCRYPT_ECDSA_PUBLIC_P256_MAGIC ("ECS1")
                    BitConverter.GetBytes(32).CopyTo(blob, 4);
                    xy.CopyTo(blob, 8);
                    using (var key = CngKey.Import(blob, CngKeyBlobFormat.EccPublicBlob))
                    using (var dsa = new ECDsaCng(key) { HashAlgorithm = CngAlgorithm.Sha256 })
                        if (dsa.VerifyData(data, sig)) return true;
                }
                catch { }
            }
            return false;
        }

        // update-manifest.json, checked: tags and file names plain, every part with a sha256 and a size
        public static UpdateManifest ParseManifest(string text, out string error)
        {
            error = null;
            var o = J.Parse(text);
            if (!(o is Dictionary<string, object>)) { error = "the update manifest isn't JSON"; return null; }
            var m = new UpdateManifest { Format = J.Int(o, "format"), MinCompanion = J.Int(o, "minCompanion"), Version = J.Str(o, "version"), Built = J.Str(o, "built"), GitCommit = J.Str(o, "gitCommit"), VersionJson = J.Get(o, "versionJson"), DeployedJson = J.Get(o, "deployedJson") };
            if (m.Format < 1) { error = "the update manifest has no format"; return null; }
            if (!ValidTag(m.Version)) { error = "the update manifest has no usable version"; return null; }
            if (!(m.VersionJson is Dictionary<string, object>) || !(m.DeployedJson is Dictionary<string, object>)) { error = "the update manifest lacks version.json or deployed.json"; return null; }
            var parts = J.Get(o, "parts") as Dictionary<string, object>;
            if (parts == null || parts.Count == 0) { error = "the update manifest lists no parts"; return null; }
            foreach (var kv in parts)
            {
                if (!PartOrder.Contains(kv.Key)) continue; // (a part this app doesn't know: a newer release; minCompanion says whether that matters)
                var p = new UpdatePart { Name = kv.Key, File = J.Str(kv.Value, "file"), Sha256 = (J.Str(kv.Value, "sha256") ?? "").ToLowerInvariant(), Version = J.Str(kv.Value, "version"), Release = J.Str(kv.Value, "release") ?? m.Version };
                long size; long.TryParse(J.Str(kv.Value, "size") ?? "", out size); p.Size = size;
                if (!ValidFile(p.File)) { error = "the " + kv.Key + " part has no plain file name"; return null; }
                if (!Sha.IsMatch(p.Sha256)) { error = "the " + kv.Key + " part has no sha256"; return null; }
                if (p.Size <= 0) { error = "the " + kv.Key + " part has no size"; return null; }
                if (string.IsNullOrEmpty(p.Version)) { error = "the " + kv.Key + " part has no version"; return null; }
                if (!ValidTag(p.Release)) { error = "the " + kv.Key + " part names no usable release"; return null; }
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
            var older = Downgrade(local, m);
            if (older != null) { p.Refused = older; p.CompanionFirst = false; p.UpToDate = false; }
            return p;
        }

        // The release Update now installs (Controller.offer): a check's while it offers one, none after a check that
        // offers nothing or after an install (whichever release it was: a pending one may have passed the offer)
        public static CheckResult OfferAfterCheck(CheckResult r) { return r != null && r.Available ? r : null; }
        public static CheckResult OfferAfterApply(CheckResult offer, ApplyResult res) { return res != null && res.Ok ? null : offer; }

        // `built` as the packager writes it (toISOString: 2026-11-10T12:00:00.000Z), an ISO time with its zone; else null
        static readonly Regex IsoTime = new Regex(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$");
        public static DateTime? BuiltTime(string s)
        {
            DateTime t;
            if (s == null || !IsoTime.IsMatch(s) || !DateTime.TryParse(s, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AdjustToUniversal, out t)) return null;
            return t;
        }

        // A release built before this package is refused (whoever can move GitHub's "latest" could serve an older,
        // validly signed release); the same build is no downgrade (the parts decide: all the same, up to date). No
        // usable build time on either side: refused (every package and manifest the packager makes has one).
        public static string Downgrade(object local, UpdateManifest m)
        {
            var mine = BuiltTime(J.Str(local, "built"));
            var theirs = BuiltTime(m.Built);
            if (mine == null) return "This package's version.json has no build time, so no release can be checked against it: download the full package again.";
            if (theirs == null) return "The update manifest of " + m.Version + " has no usable build time: not installing it.";
            if (theirs.Value < mine.Value) return "The latest release (" + m.Version + ") is older than this package; not installing it.";
            return null;
        }

        public static bool Loopback(Uri u) { return u.IsLoopback && u.Scheme == Uri.UriSchemeHttp && u.UserInfo.Length == 0; }
        public static bool TestBaseOk(string b) { Uri u; return b != null && Uri.TryCreate(b, UriKind.Absolute, out u) && Loopback(u); }

        // Whether a URL may be fetched, and whether it is the API (the only host a token goes to). testBase: --update-base,
        // a fake GitHub on this PC only (its own host plays api.github.com, http://localhost on its port the asset host).
        public static bool AllowedUrl(string url, string testBase, out bool api)
        {
            api = false;
            Uri u;
            if (url == null || !Uri.TryCreate(url, UriKind.Absolute, out u) || u.UserInfo.Length > 0) return false;
            if (testBase != null)
            {
                Uri b;
                if (!Uri.TryCreate(testBase, UriKind.Absolute, out b) || !Loopback(b)) return false; // (a test base off this PC: nothing)
                if (u.Scheme == b.Scheme && u.Host == b.Host && u.Port == b.Port) { api = true; return true; }
                return u.Scheme == Uri.UriSchemeHttp && u.Host == "localhost" && u.Port == b.Port;
            }
            if (u.Scheme != Uri.UriSchemeHttps || !u.IsDefaultPort) return false;
            string host = u.Host.ToLowerInvariant();
            if (!Hosts.Contains(host)) return false;
            api = host == "api.github.com";
            return true;
        }

        // the token for a request: only to api.github.com itself, never to a test server
        public static string TokenFor(bool api, string testBase, string token) { return api && testBase == null ? token : null; }

        public static string HostOf(string url) { Uri u; return Uri.TryCreate(url ?? "", UriKind.Absolute, out u) ? u.Host : "?"; }

        // a 206's Content-Range must start where the partial file ends and name the part's size
        public static bool ContentRangeOk(string header, long from, long total)
        {
            var m = Regex.Match(header ?? "", @"^bytes (\d+)-(\d+)/(\d+)$");
            if (!m.Success) return false;
            long a, b, t;
            return long.TryParse(m.Groups[1].Value, out a) && long.TryParse(m.Groups[2].Value, out b) && long.TryParse(m.Groups[3].Value, out t) && a == from && t == total && b == total - 1;
        }

        // a release from GET .../releases/latest or .../releases/tags/<tag>
        public static ReleaseInfo ParseRelease(string body)
        {
            var o = J.Parse(body);
            var tag = J.Str(o, "tag_name");
            if (!ValidTag(tag)) return null;
            var r = new ReleaseInfo { Tag = tag };
            foreach (var a in J.Arr(o, "assets") ?? new object[0])
            {
                long size; long.TryParse(J.Str(a, "size") ?? "", out size);
                r.Assets.Add(new ReleaseAsset { Name = J.Str(a, "name"), Url = J.Str(a, "url"), Size = size });
            }
            r.WhatsNew = WhatsNew(J.Str(o, "body"));
            return r;
        }

        public const int WhatsNewMax = 10, WhatsNewItemMax = 400;

        // The "### What's new" section of a release's notes (tools/publish-release.js puts RELEASE-NOTES.md there):
        // one plain-text line per "- " item, continuation lines joined, ** and ` dropped, at most WhatsNewMax items of
        // WhatsNewItemMax characters. Empty when the notes have no such section.
        public static List<string> WhatsNew(string body)
        {
            var items = new List<string>();
            bool inside = false;
            StringBuilder cur = null;
            Action flush = () =>
            {
                if (cur == null) return;
                var t = Regex.Replace(cur.ToString().Replace("**", "").Replace("__", "").Replace("`", ""), @"\s+", " ").Trim();
                if (t.Length > WhatsNewItemMax) t = t.Substring(0, WhatsNewItemMax - 1).TrimEnd() + "…";
                if (t.Length > 0 && items.Count < WhatsNewMax) items.Add(t);
                cur = null;
            };
            foreach (var raw in (body ?? "").Split('\n'))
            {
                var line = raw.TrimEnd('\r');
                var trim = line.Trim();
                if (trim.StartsWith("#"))
                {
                    flush();
                    var head = trim.TrimStart('#').Trim().Replace('’', '\'').ToLowerInvariant();
                    if (inside) break;
                    inside = head == "what's new";
                    continue;
                }
                if (!inside) continue;
                if (trim.StartsWith("- ") || trim.StartsWith("* ")) { flush(); cur = new StringBuilder(trim.Substring(2)); }
                else if (trim.Length > 0 && cur != null) cur.Append(' ').Append(trim);
            }
            flush();
            return items;
        }

        // the release's page on GitHub, made from the tag (never a URL from GitHub's answer)
        public static string ReleasePage(string tag) { return "https://github.com/" + Repo + "/releases/tag/" + Uri.EscapeDataString(tag ?? ""); }

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

        // Whether to install now. A deferred update (it waited for a game) waits for 2 minutes with no game, so the
        // moment after a game (a rematch being set up) isn't when the bridge stops.
        public static bool InstallNow(bool locked, DateTime? idleSinceUtc, DateTime nowUtc, bool deferred)
        {
            if (locked) return false;
            if (!deferred) return true;
            return idleSinceUtc.HasValue && nowUtc - idleSinceUtc.Value >= IdleBeforeInstall;
        }

        // backup folders to delete: all but the newest `keep`, and never `live` (the one a journal on disk points at: an
        // undo that couldn't finish still needs it)
        public static List<string> BackupsToPrune(IEnumerable<KeyValuePair<string, DateTime>> backups, int keep, string live = null)
        {
            Func<string, string> norm = d => (d ?? "").TrimEnd('\\', '/');
            return backups.Where(b => live == null || !string.Equals(norm(b.Key), norm(live), StringComparison.OrdinalIgnoreCase))
                .OrderByDescending(b => b.Value).Skip(keep).Select(b => b.Key).ToList();
        }

        // A zip entry's path inside the package, or null: under one of the part's folders or files, and never outside.
        // Windows drops trailing dots and spaces from a name ("..", ". .", ".. " are all ".."), so a segment that
        // changes under that trim is refused, as is a colon (a drive, or an alternate data stream).
        public static string EntryPath(string part, string entry)
        {
            string[] holds;
            if (entry == null || !Holds.TryGetValue(part, out holds)) return null;
            var e = entry.Replace('\\', '/');
            if (e.StartsWith("/") || e.Contains(":")) return null;
            var segs = e.Split('/').Where(s => s.Length > 0).ToArray();
            if (segs.Length == 0 || segs.Any(s => s.TrimEnd('.', ' ') != s || s.Trim().Length == 0)) return null;
            var rel = string.Join("/", segs);
            foreach (var h in holds) if (rel == h || rel.StartsWith(h + "/")) return rel;
            return null;
        }

        // and the path itself, once more as Windows resolves it: inside the hold it belongs to
        public static bool Contained(string home, string rel, string part)
        {
            string[] holds;
            if (rel == null || !Holds.TryGetValue(part, out holds)) return false;
            string full;
            try { full = Path.GetFullPath(Path.Combine(home, rel.Replace('/', '\\'))); } catch { return false; }
            foreach (var h in holds)
            {
                var hf = Path.GetFullPath(Path.Combine(home, h.Replace('/', '\\')));
                if (string.Equals(full, hf, StringComparison.OrdinalIgnoreCase) || full.StartsWith(hf + "\\", StringComparison.OrdinalIgnoreCase)) return true;
            }
            return false;
        }

        // a folder name for the backup of this version
        public static string BackupName(object local)
        {
            var v = J.Str(local, "release") ?? ("built-" + (J.Str(local, "built") ?? "unknown"));
            v = Regex.Replace(v.Length > 40 ? v.Substring(0, 40) : v, @"[^\w.-]", "-");
            return v.Trim('.').Length == 0 ? "unknown" : v;
        }

        // the journal's undo (see UndoPlan)
        public static UndoPlan Undo(Journal j)
        {
            var u = new UndoPlan();
            u.ReturnToDownload.AddRange(j.Placed);
            foreach (var rel in j.Replaced)
                if (j.Moved.Contains(rel) || !j.Existed.Contains(rel)) u.Delete.Add(rel);
            u.MoveBack.AddRange(j.Moved);
            return u;
        }

        // the package's stack\deployed.json after an update: the release's, but without new images the ids this Docker
        // gave the old ones (Controller.RewriteDeployed) stay
        public static Dictionary<string, object> MergeDeployed(object local, object fromRelease, bool imagesChanged)
        {
            var d = new Dictionary<string, object>(fromRelease as Dictionary<string, object> ?? new Dictionary<string, object>());
            if (imagesChanged || !(local is Dictionary<string, object>)) return d;
            foreach (var k in new[] { "node", "relay", "nodeConfig", "relayConfig", "nodePackage", "relayPackage" })
            {
                var v = J.Get(local, k);
                if (v != null) d[k] = v;
            }
            return d;
        }

        // the process the new exe waits for is the old app, not a later one that got its number
        public static bool SameProcess(long expectedStartTicks, long actualStartTicks)
        {
            return expectedStartTicks == 0 || Math.Abs(expectedStartTicks - actualStartTicks) < TimeSpan.TicksPerSecond;
        }

        public static string Mb(long bytes) { return (bytes / 1048576.0).ToString("0.0", System.Globalization.CultureInfo.InvariantCulture) + " MB"; }

        // What a set of parts changes, in the words the owner reads: "table" (the table part), "app" (the bridge and
        // decks, the Node runtime or this app itself), "engine" (the engine images). In that order, each once.
        public static List<string> Changes(IEnumerable<string> parts)
        {
            var set = new HashSet<string>(parts ?? new string[0]);
            var c = new List<string>();
            if (set.Contains("table")) c.Add("table");
            if (set.Contains("app") || set.Contains("runtime") || set.Contains("companion")) c.Add("app");
            if (set.Contains("images")) c.Add("engine");
            return c;
        }

        // "the table", "the table and the app", "the table, the app and the engine"
        public static string ChangesWords(IList<string> c)
        {
            var w = (c ?? new List<string>()).Select(x => "the " + x).ToList();
            if (w.Count == 0) return "nothing";
            if (w.Count == 1) return w[0];
            return string.Join(", ", w.Take(w.Count - 1)) + " and " + w[w.Count - 1];
        }

        public static string PartWords(string part) { return part == "app" ? "bridge and decks" : part == "images" ? "engine" : part == "companion" ? "this app" : part == "runtime" ? "Node runtime" : part; }

        public static string Describe(UpdatePlan p, UpdateManifest m)
        {
            var names = p.Fetch.Select(x => PartWords(x.Name));
            return "Update available: " + m.Version + ": changes " + ChangesWords(Changes(p.Fetch.Select(x => x.Name))) + " (" + string.Join(", ", names) + "; " + Mb(p.Bytes) + " to download).";
        }

        // the line after an install: "Updated to v3: the table and the app changed."
        public static string UpdatedText(string version, IEnumerable<string> parts)
        {
            var c = Changes(parts);
            return "Updated to " + version + (c.Count > 0 ? ": " + ChangesWords(c) + " changed" : "") + ".";
        }

        // the automatic check's line for the release the player went back from
        public static string SkippedText(string version) { return "Skipped " + version + " (you went back from it with Revert). Check for updates offers it again."; }

        // updates.json "skipped": every release Revert went back from since the last manual check, comma-separated (a
        // tag never holds a comma, ValidTag). Two reverts in a row (v3 to v2 to v1) skip both v3 and v2.
        public static bool IsSkipped(string skipped, string version)
        {
            return skipped != null && version != null && skipped.Split(',').Contains(version);
        }
        public static string AddSkipped(string skipped, string version)
        {
            if (version == null || IsSkipped(skipped, version)) return skipped;
            return string.IsNullOrEmpty(skipped) ? version : skipped + "," + version;
        }

        // the automatic check: a release the player went back from isn't offered; a manual check, or any other
        // release, is. (skipped: updates.json "skipped", written by Revert, cleared by a manual check)
        public static CheckResult SkipReverted(CheckResult r, string skipped, bool manual)
        {
            if (manual || r == null || !r.Available || !IsSkipped(skipped, r.Manifest.Version)) return r;
            r.Skipped = true;
            r.Text = SkippedText(r.Manifest.Version);
            return r;
        }

        // ── Revert (docs/companion-app-spec.md §11.6)

        public const string RevertWaitsText = "The revert is waiting for the game to end; update after it has gone back.";
        public const string NoBackup = "No earlier version is kept yet: the first update makes one.";
        public const string BackupExe = "companion/MTG Companion.exe"; // (this app's exe, kept in the backup by an update that replaced it)
        public const string RevertHold = "revert-undo"; // (in the package: the newer files while a revert runs, so it can be undone)

        // Whether a backup can be put back over the package as it is now. current, backup: the two version.json.
        // has(rel): whether the backup holds that package path. A part whose version differs must be in the backup
        // (only the newest backup keeps the engine images); a part the two agree on, or can't say, needs nothing.
        public static RevertInfo PlanRevert(string backupDir, object current, object backup, Func<string, bool> has)
        {
            var r = new RevertInfo { Backup = backupDir };
            if (backupDir == null) { r.Why = NoBackup; return r; }
            if (!(backup is Dictionary<string, object>)) { r.Why = "The newest backup (" + Path.GetFileName(backupDir) + ") has no version.json, so it can't be put back."; return r; }
            r.Target = VersionName(backup);
            r.From = VersionName(current);
            var changed = new List<string>();
            foreach (var part in new[] { "app", "table", "runtime", "images" })
            {
                string mine = LocalVersion(current, part), theirs = LocalVersion(backup, part);
                if (mine == null || theirs == null || mine == theirs) continue;
                if (!has(part == "app" ? "bridge" : Holds[part][0]))
                {
                    r.Why = "The backup of " + r.Target + " lacks " + (part == "images" ? "the engine images (only the newest backup keeps them)" : "its " + PartWords(part)) + ", so it can't be put back.";
                    return r;
                }
                changed.Add(part);
            }
            string cMine = LocalVersion(current, "companion"), cTheirs = LocalVersion(backup, "companion");
            if (cMine != null && cTheirs != null && cMine != cTheirs && has(BackupExe)) { r.Self = true; r.CompanionVersion = cTheirs; changed.Add("companion"); }
            r.Changes = Changes(changed);
            r.Possible = true;
            return r;
        }

        // What a revert replaces and what it moves back. A part counts as replaced by the last update when the backup
        // holds one of its own paths (not version.json or deployed.json, which every update moves): then all of its
        // paths are replaced, so one the update added and the backup lacks goes too (as an update's undo deletes it).
        public class RevertSet { public List<string> Replaced = new List<string>(), Restore = new List<string>(); }
        public static RevertSet RevertPaths(Func<string, bool> inBackup)
        {
            var always = new[] { "version.json", "stack/deployed.json" };
            var s = new RevertSet();
            s.Replaced.AddRange(always);
            foreach (var part in PartOrder)
            {
                string[] holds;
                if (Holds.TryGetValue(part, out holds) && holds.Where(h => !always.Contains(h)).Any(inBackup)) s.Replaced.AddRange(holds);
            }
            s.Replaced = s.Replaced.Distinct().ToList();
            s.Restore = s.Replaced.Where(inBackup).ToList();
            return s;
        }

        // "v2026.11.10-1432", or "the build of 2026-11-09"
        public static string VersionName(object v)
        {
            var rel = J.Str(v, "release");
            if (rel != null) return rel;
            var b = J.Str(v, "built");
            return "the build of " + (b != null && b.Length >= 10 ? b.Substring(0, 10) : "?");
        }

        // the button's words, its hover line and its question
        public static string RevertLabel(RevertInfo r) { return r != null && r.Possible ? "Revert to " + r.Target : "Revert update"; }
        public static string RevertTitle(RevertInfo r)
        {
            if (r == null || !r.Possible) return r != null && r.Why != null ? r.Why : NoBackup;
            return "Goes back to " + r.Target + " (from " + r.From + ")" + (r.Changes.Count > 0 ? ": puts back " + ChangesWords(r.Changes) : "") + ".";
        }
        public static string RevertConfirm(RevertInfo r)
        {
            if (r == null || !r.Possible) return null;
            return "Go back to " + r.Target + "?\n\nThis puts back " + (r.Changes.Count > 0 ? ChangesWords(r.Changes) : "the files") + " as they were before the last update (" + r.From + ")."
                + (r.Self ? " This app restarts as the older version." : "")
                + "\n\nThe bridge stops for a minute. During a game it waits, and goes back 2 minutes after the game. The automatic check won't offer " + r.From + " again; Check for updates does.";
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

    // The file operations of the exe swap, so the selftest can make them fail
    public interface IFileOps { void Move(string from, string to); void Delete(string path); bool Exists(string path); void Sleep(int ms); }
    public class RealFileOps : IFileOps
    {
        public void Move(string from, string to) { File.Move(from, to); }
        public void Delete(string path) { File.Delete(path); }
        public bool Exists(string path) { return File.Exists(path); }
        public void Sleep(int ms) { System.Threading.Thread.Sleep(ms); }
    }

    // The GitHub token, if the user gave one: DPAPI (this Windows user) in the state folder
    public static class TokenStore
    {
        public static string FileOf(string stateDir) { return Path.Combine(stateDir, "github-token.bin"); }
        public static readonly byte[] Salt = Encoding.UTF8.GetBytes("MTG Companion github token");
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
}
