// --selftest, Revert update and what an update changes (docs/companion-app-spec.md §11.6): the check line's parts, the
// release a revert skips, which backup can be put back, the status page's button, and a revert of a real temp package
// with FakeEffects (happy path, a game on, a failing step undone, a journal killed half way and recovered).
// `--selftest --section revert` runs this section alone (tests/test_companion_update.js does, and
// tools/mutate-companion-revert.js breaks the rules one at a time).
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

namespace MtgCompanion
{
    public static partial class SelfTest
    {
        static void RevertChecks()
        {
            sb.AppendLine("== revert");
            Check("repo: the renamed repository (Table-Top-Simulator-MTG-Rules-Enforcer)", Updates.Repo == "Vibecoding-mods/Table-Top-Simulator-MTG-Rules-Enforcer", Updates.Repo);
            // ── what a release changes, in the check line
            Check("changes: the table, the app, the engine, each once and in that order",
                Updates.Changes(new[] { "images", "companion", "app", "table", "runtime" }).SequenceEqual(new[] { "table", "app", "engine" }), string.Join(",", Updates.Changes(new[] { "images", "companion", "app", "table", "runtime" })));
            Check("changes: the runtime or this app alone are the app", Updates.Changes(new[] { "runtime" }).SequenceEqual(new[] { "app" }) && Updates.Changes(new[] { "companion" }).SequenceEqual(new[] { "app" }));
            Check("changes: words", Updates.ChangesWords(new[] { "table" }) == "the table" && Updates.ChangesWords(new[] { "table", "app" }) == "the table and the app" && Updates.ChangesWords(new[] { "table", "app", "engine" }) == "the table, the app and the engine", Updates.ChangesWords(new[] { "table", "app", "engine" }));
            string err;
            var local = J.Parse("{\"built\":\"2026-11-10T12:00:00Z\",\"parts\":{\"app\":\"a1\",\"table\":\"s1\",\"images\":\"i1\",\"runtime\":\"r1\",\"companion\":\"c1\"}}");
            var m = Updates.ParseManifest(Manifest("\"app\":" + Part("app.zip", "a2") + ",\"table\":" + Part("table.zip", "s2") + ",\"images\":" + Part("images.tar", "i1") + ",\"companion\":" + Part("MTG.Companion.exe", "c2")), out err);
            var plan = Updates.Plan(local, m, 2);
            var line = Updates.Describe(plan, m);
            Check("check line: names what changed (the table and the app), then the parts and the size", line.StartsWith("Update available: " + m.Version + ": changes the table and the app (") && line.Contains("bridge and decks") && line.Contains("this app") && line.Contains("MB to download"), line);
            Check("updated line: says what changed", Updates.UpdatedText("v3", new[] { "table", "app" }) == "Updated to v3: the table and the app changed." && Updates.UpdatedText("v3", new string[0]) == "Updated to v3.", Updates.UpdatedText("v3", new[] { "table", "app" }));
            var r = new CheckResult { Manifest = m, Plan = plan, Text = line };
            var us = new UpdateState();
            us.Checked(r, false, DateTime.UtcNow);
            Check("state: an offer carries what it changes (the page's changes)", us.Changes != null && us.Changes.SequenceEqual(new[] { "table", "app" }), us.Changes == null ? "null" : string.Join(",", us.Changes));
            var sec = J.Parse(J.Write(WebUi.UpdateSection(us, true, false)));
            Check("page: the section sends changes", J.Arr(sec, "changes") != null && J.Arr(sec, "changes").Select(x => x.ToString()).SequenceEqual(new[] { "table", "app" }), J.Write(sec));

            // ── the release a revert went back from: the automatic check skips it, a manual one doesn't
            var auto = Updates.SkipReverted(new CheckResult { Manifest = m, Plan = plan, Text = line }, m.Version, false);
            Check("skip: the automatic check doesn't offer the release reverted from", auto.Skipped && !auto.Available && auto.Text == Updates.SkippedText(m.Version) && Updates.OfferAfterCheck(auto) == null, auto.Text);
            us = new UpdateState(); us.Checked(auto, false, DateTime.UtcNow);
            Check("skip: the state says skipped, nothing offered", us.Status == "skipped" && us.Available == null && us.Error == null, us.Status);
            var manual = Updates.SkipReverted(new CheckResult { Manifest = m, Plan = plan, Text = line }, m.Version, true);
            Check("skip: a manual check offers it again", manual.Available && !manual.Skipped && manual.Text == line);
            var other = Updates.SkipReverted(new CheckResult { Manifest = m, Plan = plan, Text = line }, "v-older", false);
            Check("skip: a newer release (another tag) is offered by the automatic check", other.Available && !other.Skipped);
            Check("skip: nothing skipped: offered", Updates.SkipReverted(new CheckResult { Manifest = m, Plan = plan, Text = line }, null, false).Available);

            // ── which backup can be put back
            var cur = J.Parse("{\"release\":\"v2\",\"built\":\"2026-11-10T12:00:00Z\",\"parts\":{\"app\":\"a2\",\"table\":\"s1\",\"images\":\"i2\",\"runtime\":\"r1\",\"companion\":\"c2\"}}");
            var old = J.Parse("{\"release\":\"v1\",\"built\":\"2026-11-01T12:00:00Z\",\"parts\":{\"app\":\"a1\",\"table\":\"s1\",\"images\":\"i1\",\"runtime\":\"r1\",\"companion\":\"c1\"}}");
            var none = Updates.PlanRevert(null, cur, null, x => false);
            Check("plan: no backup: not possible, says no earlier version is kept", !none.Possible && none.Why == Updates.NoBackup);
            Check("plan: a backup without version.json: not possible", !Updates.PlanRevert(@"C:\p\backup\v1", cur, null, x => true).Possible);
            var full = Updates.PlanRevert(@"C:\p\backup\v1", cur, old, Files("bridge", "images", "version.json", Updates.BackupExe));
            Check("plan: the app and the engine differ, both kept: possible, puts back the app and the engine, this app too", full.Possible && full.Target == "v1" && full.From == "v2" && full.Changes.SequenceEqual(new[] { "app", "engine" }) && full.Self && full.CompanionVersion == "c1", string.Join(",", full.Changes) + " self " + full.Self);
            var noImages = Updates.PlanRevert(@"C:\p\backup\v1", cur, old, Files("bridge", "version.json"));
            Check("plan: the engine differs but the backup has no images: not possible, says why", !noImages.Possible && noImages.Why.Contains("engine images"), noImages.Why);
            var noBridge = Updates.PlanRevert(@"C:\p\backup\v1", cur, old, Files("images", "version.json"));
            Check("plan: the app differs but the backup has no bridge: not possible", !noBridge.Possible && noBridge.Why.Contains("bridge and decks"), noBridge.Why);
            var noExe = Updates.PlanRevert(@"C:\p\backup\v1", cur, old, Files("bridge", "images", "version.json"));
            Check("plan: no exe in the backup: possible, this app stays (not Self)", noExe.Possible && !noExe.Self && noExe.Changes.SequenceEqual(new[] { "app", "engine" }), string.Join(",", noExe.Changes));
            var same = Updates.PlanRevert(@"C:\p\backup\v1", cur, J.Parse("{\"release\":\"v1\",\"parts\":{\"app\":\"a2\",\"table\":\"s1\",\"images\":\"i2\",\"runtime\":\"r1\",\"companion\":\"c2\"}}"), x => false);
            Check("plan: only version.json differs: possible, nothing else needed", same.Possible && same.Changes.Count == 0);
            Check("plan: a version with no release name: the build date", Updates.VersionName(J.Parse("{\"built\":\"2026-11-09T14:32:00.000Z\"}")) == "the build of 2026-11-09");

            // ── what a revert replaces: a part the backup holds, all its paths; version.json and deployed.json always
            var set = Updates.RevertPaths(Files("images", "version.json", "stack/deployed.json"));
            Check("paths: an engine-only backup: version.json, deployed.json and images, nothing of the app", set.Replaced.OrderBy(x => x).SequenceEqual(new[] { "images", "stack/deployed.json", "version.json" }) && set.Restore.Count == 3, string.Join(",", set.Replaced));
            set = Updates.RevertPaths(Files("bridge", "decks", "version.json", "stack/deployed.json"));
            Check("paths: an app backup: every app path replaced (one the update added goes), only the kept ones put back",
                set.Replaced.Contains("scenarios") && set.Replaced.Contains("manabrew") && set.Replaced.Contains("README-FRIEND.txt") && !set.Replaced.Contains("images") && !set.Replaced.Contains("table")
                && set.Restore.OrderBy(x => x).SequenceEqual(new[] { "bridge", "decks", "stack/deployed.json", "version.json" }), string.Join(",", set.Replaced) + " / " + string.Join(",", set.Restore));

            // ── the journal knows it is a revert
            var j = new Journal { Kind = "revert", Source = @"C:\p\backup\v1", Target = "v1", Backup = @"C:\p\revert-undo\v2" };
            var back = Journal.FromJson(J.Parse(J.Write(j.ToJson())));
            Check("journal: a revert's kind and source read back", back != null && back.Kind == "revert" && back.Source == j.Source, back == null ? "null" : J.Write(back.ToJson()));
            Check("journal: an update's reads back as an update", Journal.FromJson(J.Parse("{\"target\":\"v2\",\"backup\":\"C:\\\\p\\\\backup\\\\v1\"}")).Kind == "update");
            Check("journal: a revert without its source: unreadable (left as is)", Journal.FromJson(J.Parse("{\"kind\":\"revert\",\"target\":\"v1\",\"backup\":\"C:\\\\x\"}")) == null);

            // ── the status page's button
            var st = new UpdateState { Status = "up-to-date", Current = "Version v2", Text = "Up to date (v2).", Revert = full };
            sec = J.Parse(J.Write(WebUi.UpdateSection(st, true, false)));
            var rb = J.Arr(sec, "actions").FirstOrDefault(a => J.Str(a, "id") == "update-revert");
            Check("button: a backup: Revert to v1, enabled, says what it puts back", rb != null && J.Str(rb, "label") == "Revert to v1" && J.Bool(rb, "enabled") && J.Str(rb, "title").Contains("from v2") && J.Str(rb, "title").Contains("the app and the engine"), J.Write(rb));
            Check("button: it asks first, naming both versions and the skip", J.Str(rb, "confirm") != null && J.Str(rb, "confirm").Contains("Go back to v1?") && J.Str(rb, "confirm").Contains("won't offer v2 again") && J.Str(rb, "confirm").Contains("2 minutes after the game"), J.Str(rb, "confirm"));
            Check("button: the section's revert says where it goes", J.Bool(J.Get(sec, "revert"), "possible") && J.Str(J.Get(sec, "revert"), "target") == "v1");
            st.Revert = none;
            rb = J.Arr(J.Parse(J.Write(WebUi.UpdateSection(st, true, false))), "actions").FirstOrDefault(a => J.Str(a, "id") == "update-revert");
            Check("button: no backup: disabled, its line says why, no question", rb != null && !J.Bool(rb, "enabled") && J.Str(rb, "title") == Updates.NoBackup && J.Str(rb, "confirm") == null && J.Str(rb, "label") == "Revert update", J.Write(rb));
            foreach (var status in new[] { "checking", "downloading", "installing", "reverting", "ready", "revert-ready" })
            {
                var busy = new UpdateState { Status = status, Available = status == "ready" ? "v3" : null, Revert = full };
                rb = J.Arr(J.Parse(J.Write(WebUi.UpdateSection(busy, true, false))), "actions").FirstOrDefault(a => J.Str(a, "id") == "update-revert");
                Check("button: " + status + ": disabled", rb != null && !J.Bool(rb, "enabled") && J.Str(rb, "confirm") == null, J.Write(rb));
            }
            Check("titles: reverting, waiting for the game, reverted, skipped", WebUi.UpdateTitle(new UpdateState { Status = "reverting" }).Contains("Going back") && WebUi.UpdateTitle(new UpdateState { Status = "revert-ready" }).Contains("after the game")
                && WebUi.UpdateTitle(new UpdateState { Status = "reverted" }).Contains("Went back") && WebUi.UpdateTitle(new UpdateState { Status = "skipped" }).Contains("skipped"));
            var rs = new UpdateState { Status = "available", Available = "v3", Notes = "x", Changes = new List<string> { "table" } };
            rs.Reverted(new ApplyResult { Deferred = true, Text = "Revert ready" });
            Check("state: a revert during a game waits (revert-ready), the offer kept", rs.Status == "revert-ready" && rs.RevertWaiting && rs.Available == "v3", rs.Status);
            rs.Reverted(new ApplyResult { Ok = true, Text = "Went back to v1." });
            Check("state: reverted: nothing offered any more", rs.Status == "reverted" && rs.Available == null && rs.Changes == null && !rs.RevertWaiting, rs.Status);
            rs.Reverted(new ApplyResult { Text = "The revert failed and was undone: x." });
            Check("state: a failed revert is failed, with the error", rs.Status == "failed" && rs.Error.Contains("undone"));

            RevertFilesChecks();
        }

        // a package on disk: v2 installed over v1 (backup\v1 with the old bridge, engine images, version.json, exe)
        static string MakeRevertPkg(string root, string name)
        {
            var pkg = Path.Combine(root, name);
            Action<string, string> put = (rel, text) => { var p = Path.Combine(pkg, rel.Replace('/', '\\')); Directory.CreateDirectory(Path.GetDirectoryName(p)); File.WriteAllText(p, text); };
            put("version.json", "{\"release\":\"v2\",\"built\":\"2026-11-10T12:00:00Z\",\"parts\":{\"app\":\"a2\",\"table\":\"s1\",\"images\":\"i2\",\"runtime\":\"r1\",\"companion\":\"c2\"}}");
            put("stack/deployed.json", "{\"bridge\":\"b2\"}");
            put("bridge/bridge.js", "new bridge");
            put("bridge/image-cache-klrmngr.json", "bigger cache");
            put("decks/a.json", "{}");
            put("scenarios/new.json", "added by v2");
            put("images/mtg-images.tar", "new tar");
            put("table/MTG Table.json", "table");
            put("backup/v1/version.json", "{\"release\":\"v1\",\"built\":\"2026-11-01T12:00:00Z\",\"parts\":{\"app\":\"a1\",\"table\":\"s1\",\"images\":\"i1\",\"runtime\":\"r1\",\"companion\":\"c1\"}}");
            put("backup/v1/stack/deployed.json", "{\"bridge\":\"b1\"}");
            put("backup/v1/bridge/bridge.js", "old bridge");
            put("backup/v1/bridge/image-cache-klrmngr.json", "small cache");
            put("backup/v1/decks/a.json", "{}");
            put("backup/v1/images/mtg-images.tar", "old tar");
            return pkg;
        }

        // every file and its text, but logs and the backup's picture cache (an undone revert leaves the newer cache
        // there: it only grows, so that is no loss)
        static string Snap(string dir)
        {
            if (!Directory.Exists(dir)) return "";
            return string.Join("|", Directory.GetFiles(dir, "*", SearchOption.AllDirectories).Select(f => f.Substring(dir.Length + 1).Replace('\\', '/')).Where(f => !f.StartsWith("logs/") && !f.EndsWith("backup/v1/bridge/image-cache-klrmngr.json")).OrderBy(f => f, StringComparer.Ordinal)
                .Select(f => f + "=" + File.ReadAllText(Path.Combine(dir, f.Replace('/', '\\')))));
        }

        static void RevertFilesChecks()
        {
            sb.AppendLine("-- revert: a package on disk (FakeEffects)");
            var root = Path.Combine(Path.GetTempPath(), "mtg-selftest-revert-" + Guid.NewGuid().ToString("N"));
            var oldLog = Log.File;
            try
            {
                Directory.CreateDirectory(root);
                Log.File = Path.Combine(root, "companion.log");
                // the happy path
                var pkg = MakeRevertPkg(root, "p1");
                var state = Path.Combine(root, "s1");
                var fxFile = Path.Combine(root, "fx1.txt");
                var u = new Updater(Layout.Make(Mode.Friend, pkg), state, Path.Combine(pkg, "MTG Companion.exe"), null);
                var info = u.FindRevert();
                Check("disk: the newest backup found: v1, possible", info.Possible && info.Target == "v1" && info.From == "v2" && !info.Self && info.Changes.SequenceEqual(new[] { "app", "engine" }), info.Why ?? string.Join(",", info.Changes));
                var res = u.Revert(new FakeEffects(fxFile, new string[0], () => false), "");
                Check("disk: reverted, says to what, from what, and what went back", res.Ok && !res.Swapping && res.Text.StartsWith("Went back to v1 (from v2): the app and the engine put back.") && res.Text.Contains("skips v2"), res.Text);
                Check("disk: the old bridge, tar, deployed.json and version.json back", File.ReadAllText(Path.Combine(pkg, "bridge", "bridge.js")) == "old bridge" && File.ReadAllText(Path.Combine(pkg, "images", "mtg-images.tar")) == "old tar"
                    && File.ReadAllText(Path.Combine(pkg, "stack", "deployed.json")) == "{\"bridge\":\"b1\"}" && J.Str(J.Parse(File.ReadAllText(Path.Combine(pkg, "version.json"))), "release") == "v1", Snap(pkg));
                Check("disk: what v2 added to the app is gone (scenarios\\), the table untouched", !Directory.Exists(Path.Combine(pkg, "scenarios")) && File.ReadAllText(Path.Combine(pkg, "table", "MTG Table.json")) == "table", Snap(pkg));
                Check("disk: the newer picture cache kept", File.ReadAllText(Path.Combine(pkg, "bridge", "image-cache-klrmngr.json")) == "bigger cache");
                Check("disk: version.json names this app's own version (no exe went back)", J.Str(J.Get(J.Parse(File.ReadAllText(Path.Combine(pkg, "version.json"))), "parts"), "companion") == "c2");
                Check("disk: no journal, no backup\\v1, no revert-undo left", !File.Exists(Path.Combine(pkg, Updates.JournalFile)) && !Directory.Exists(Path.Combine(pkg, "backup", "v1")) && !Directory.Exists(Path.Combine(pkg, Updates.RevertHold)), Snap(pkg));
                var fx = File.ReadAllLines(fxFile);
                Check("disk: bridge stopped, reloaded, the old images loaded, bridge started (no save: the table didn't change)", fx.SequenceEqual(new[] { "stop-bridge", "reload", "load-images", "start-bridge" }), string.Join(",", fx));
                Check("disk: the release reverted from is remembered as skipped", J.Str(u.State(), "skipped") == "v2", J.Write(u.State()));
                var after = u.FindRevert();
                Check("disk: then no backup: the button greys out", !after.Possible && after.Why == Updates.NoBackup, after.Why);

                // a game on: nothing touched, remembered, then done after it
                pkg = MakeRevertPkg(root, "p2");
                state = Path.Combine(root, "s2"); fxFile = Path.Combine(root, "fx2.txt");
                u = new Updater(Layout.Make(Mode.Friend, pkg), state, Path.Combine(pkg, "MTG Companion.exe"), null);
                var before = Snap(pkg);
                res = u.Revert(new FakeEffects(fxFile, new string[0], () => true), "");
                Check("game on: deferred, says it goes back after the game", res.Deferred && !res.Ok && res.Text.Contains("after this game") && res.Text.Contains("v1"), res.Text);
                Check("game on: nothing touched, no effects, waiting remembered", Snap(pkg) == before && !File.Exists(fxFile) && J.Str(u.State(), "pendingRevert") != null);
                res = u.Revert(new FakeEffects(fxFile, new string[0], () => false), "");
                Check("game over: reverted, the wait cleared", res.Ok && J.Str(u.State(), "pendingRevert") == null, res.Text);

                // a step that fails: undone, the package exactly as it was, nothing skipped
                pkg = MakeRevertPkg(root, "p3");
                state = Path.Combine(root, "s3"); fxFile = Path.Combine(root, "fx3.txt");
                u = new Updater(Layout.Make(Mode.Friend, pkg), state, Path.Combine(pkg, "MTG Companion.exe"), null);
                before = Snap(pkg);
                res = u.Revert(new FakeEffects(fxFile, new[] { "start-bridge" }, () => false), "");
                Check("failed: undone, says so", !res.Ok && res.Text.Contains("The revert failed and was undone") && res.Text.Contains("bridge didn't start"), res.Text);
                Check("failed: every file exactly as it was (backup\\v1 too)", Snap(pkg) == before, Snap(pkg));
                Check("failed: nothing skipped", J.Str(u.State(), "skipped") == null);
                fx = File.ReadAllLines(fxFile);
                Check("failed: the newer images loaded again, the bridge started again", fx.SequenceEqual(new[] { "stop-bridge", "reload", "load-images", "start-bridge", "reload", "load-images", "start-bridge" }), string.Join(",", fx));

                // the journal can't be written: nothing changed, the bridge never stopped
                u.TestJournalFail = true;
                File.Delete(fxFile);
                res = u.Revert(new FakeEffects(fxFile, new string[0], () => false), "");
                Check("journal unwritable: refused, nothing changed, the bridge untouched", !res.Ok && res.Text.Contains("Nothing was changed") && Snap(pkg) == before && !File.Exists(fxFile), res.Text);
                u.TestJournalFail = false;

                // killed half way (a revert journal on disk, as a kill leaves it): Recover undoes it
                pkg = MakeRevertPkg(root, "p4");
                before = Snap(pkg);
                var hold = Path.Combine(pkg, Updates.RevertHold, "v2");
                Directory.CreateDirectory(Path.Combine(hold, "stack"));
                File.Move(Path.Combine(pkg, "version.json"), Path.Combine(hold, "version.json"));
                Directory.Move(Path.Combine(pkg, "bridge"), Path.Combine(hold, "bridge"));
                Directory.Move(Path.Combine(pkg, "backup", "v1", "bridge"), Path.Combine(pkg, "bridge")); // (placed, then killed)
                var kj = new Journal { Kind = "revert", Source = Path.Combine(pkg, "backup", "v1"), Target = "v1", Backup = hold, Phase = "placing",
                    Replaced = new List<string> { "version.json", "stack/deployed.json", "bridge", "decks", "images" }, Existed = new List<string> { "version.json", "stack/deployed.json", "bridge", "decks", "images" }, Moved = new List<string> { "version.json", "bridge" } };
                kj.Placed.Add(new[] { "bridge", Path.Combine(pkg, "backup", "v1", "bridge") });
                File.WriteAllText(Path.Combine(pkg, Updates.JournalFile), J.Write(kj.ToJson()));
                var said = Updater.Recover(pkg);
                Check("killed placing: Recover undoes it and says so", said != null && said.Contains("The revert to v1 was interrupted, so it was undone"), said);
                Check("killed placing: every file exactly as it was, no journal", Snap(pkg) == before && !File.Exists(Path.Combine(pkg, Updates.JournalFile)), Snap(pkg));
                // killed with everything placed: finished, the newer files and the used backup go
                pkg = MakeRevertPkg(root, "p5");
                hold = Path.Combine(pkg, Updates.RevertHold, "v2");
                Directory.CreateDirectory(hold);
                Directory.Move(Path.Combine(pkg, "bridge"), Path.Combine(hold, "bridge"));
                Directory.Move(Path.Combine(pkg, "backup", "v1", "bridge"), Path.Combine(pkg, "bridge"));
                kj = new Journal { Kind = "revert", Source = Path.Combine(pkg, "backup", "v1"), Target = "v1", Backup = hold, Phase = "placed", Replaced = new List<string> { "bridge" }, Existed = new List<string> { "bridge" }, Moved = new List<string> { "bridge" } };
                File.WriteAllText(Path.Combine(pkg, Updates.JournalFile), J.Write(kj.ToJson()));
                said = Updater.Recover(pkg);
                Check("killed placed: Recover finishes it", said != null && said.Contains("The revert to v1 was interrupted after its files were in place"), said);
                Check("killed placed: the old bridge stays, the newer files and the backup gone", File.ReadAllText(Path.Combine(pkg, "bridge", "bridge.js")) == "old bridge" && !Directory.Exists(hold) && !Directory.Exists(Path.Combine(pkg, "backup", "v1")) && !File.Exists(Path.Combine(pkg, Updates.JournalFile)), Snap(pkg));
            }
            catch (Exception e) { Check("revert on disk: ran to the end", false, e.ToString()); }
            finally
            {
                Log.File = oldLog;
                try { Directory.Delete(root, true); } catch { }
            }
        }
    }
}
