// Pure decisions: probe facts in, a light out. No I/O here, so --selftest can feed canned inputs (SelfTest.cs).
// C# 5 only (csc 4.8): no $"", no ?., no => members, no nameof, no out var.
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace MtgCompanion
{
    public enum Light { Grey, Busy, Green, Amber, Red }

    // One light's answer: colour, a plain sentence, at most one fix button, and an action the step runner may take.
    public class Verdict
    {
        public Light Light;
        public string Text;
        public string Fix;       // a Fixes.* id, or null
        public string FixLabel;
        public string Action;    // what the step should do next (Actions.*), or null
        public string Hint;      // longer help for the hint box (addresses, TTS menu path), or null

        public Verdict(Light light, string text) { Light = light; Text = text; }
        public Verdict WithFix(string id, string label) { Fix = id; FixLabel = label; return this; }
        public Verdict WithAction(string a) { Action = a; return this; }
        public Verdict WithHint(string h) { Hint = h; return this; }
        public override string ToString() { return Light + ": " + Text + (Fix != null ? " [" + FixLabel + "]" : "") + (Action != null ? " {" + Action + "}" : ""); }
    }

    public static class Fixes
    {
        public const string Retry = "retry";             // run the start sequence again from this step
        public const string DockerStart = "docker-start";
        public const string ImagesLoad = "images-load";
        public const string StackRestart = "stack-restart";
        public const string BridgeRestart = "bridge-restart";
        public const string BridgeStart = "bridge-start";   // only when nothing runs: never locked
        public const string TtsOpen = "tts-open";
        public const string ShowProgram = "show-program";

        // the fixes that restart or change the engine: locked while a game is on (or can't tell)
        public static bool LocksDuringGame(string fix)
        {
            return fix == ImagesLoad || fix == StackRestart || fix == BridgeRestart;
        }
    }

    public static class Actions
    {
        public const string StartDesktop = "start-desktop";
        public const string Wait = "wait";
        public const string Load = "load";
        public const string StartBridge = "start-bridge";
    }

    // ───────────────────────────── where the app runs from ─────────────────────────────

    public enum Mode { None, Friend, Home }

    // Every path the app uses, for one of the two layouts.
    //   friend: the package folder (version.json beside the exe), bundled node, compose project "mtg-table"
    //   home:   the repo (bridge\bridge.js and Start MTG.bat), node on PATH, compose project "stack" (the folder name)
    public class Layout
    {
        public Mode Mode;
        public string Home;
        public string VersionFile, ComposeFile, Project, NodeExe, BridgeJs, LogsDir, CompanionLog, BridgeLog;
        public string ImagesTar, TableJson, TablePng, DeployedFile, EnvFile;
        public string[] ResumeFiles;

        public bool Friend { get { return Mode == Mode.Friend; } }

        public static Layout Make(Mode mode, string home)
        {
            var l = new Layout();
            l.Mode = mode;
            l.Home = home;
            l.ComposeFile = Path.Combine(home, "stack", "compose.yml");
            l.BridgeJs = Path.Combine(home, "bridge", "bridge.js");
            l.EnvFile = Path.Combine(home, "stack", ".env");
            if (mode == Mode.Friend)
            {
                l.VersionFile = Path.Combine(home, "version.json");
                l.Project = "mtg-table";
                l.NodeExe = Path.Combine(home, "runtime", "node", "node.exe");
                l.LogsDir = Path.Combine(home, "logs");
                l.BridgeLog = Path.Combine(l.LogsDir, "bridge.log");
                l.TableJson = Path.Combine(home, "table", "MTG Table.json");
                l.TablePng = Path.Combine(home, "table", "MTG Table.png");
                l.ImagesTar = null; // FindImagesTar fills it
                l.DeployedFile = Path.Combine(home, "stack", "deployed.json");
                // (where the bridge keeps its resume file under MTG_HOME isn't fixed yet: both places are read)
                l.ResumeFiles = new[] { Path.Combine(home, "tmp", "bridge-game.json"), Path.Combine(l.LogsDir, "bridge-game.json") };
            }
            else
            {
                l.Project = "stack";
                l.NodeExe = "node";
                l.LogsDir = Path.Combine(home, "tmp");
                l.BridgeLog = Path.Combine(l.LogsDir, "bridge-live.log");
                l.DeployedFile = Path.Combine(home, "stack", "deployed.json");
                l.ResumeFiles = new[] { Path.Combine(home, "tmp", "bridge-game.json") };
            }
            l.CompanionLog = Path.Combine(l.LogsDir, "companion.log");
            return l;
        }
    }

    public static class Logic
    {
        public const string DockerUrl = "https://www.docker.com/products/docker-desktop/";
        public const string RelayImage = "mtg-relay:exile", NodeImage = "mtg-forge-node:exile";
        public const string Room = "tts-commander";
        public const string DefaultSaveName = "MTG Table (rules engine)";

        // Friend mode when version.json sits beside the exe; home mode when the exe is inside the repo (built to
        // companion\bin, so look up to 4 folders up for bridge\bridge.js + Start MTG.bat).
        public static Layout DetectLayout(string exeDir, Func<string, bool> fileExists, string overrideHome)
        {
            if (!string.IsNullOrEmpty(overrideHome))
            {
                if (fileExists(Path.Combine(overrideHome, "version.json"))) return Layout.Make(Mode.Friend, overrideHome);
                if (IsRepo(overrideHome, fileExists)) return Layout.Make(Mode.Home, overrideHome);
                return null;
            }
            if (fileExists(Path.Combine(exeDir, "version.json"))) return Layout.Make(Mode.Friend, exeDir);
            string dir = exeDir;
            for (int i = 0; i < 5 && !string.IsNullOrEmpty(dir); i++)
            {
                if (IsRepo(dir, fileExists)) return Layout.Make(Mode.Home, dir);
                dir = Path.GetDirectoryName(dir);
            }
            return null;
        }

        static bool IsRepo(string dir, Func<string, bool> fileExists)
        {
            return fileExists(Path.Combine(dir, "bridge", "bridge.js")) && fileExists(Path.Combine(dir, "Start MTG.bat"));
        }

        // images\mtg-images.tar, else .tar.gz, else any .tar* in images\
        public static string FindImagesTar(string home, Func<string, bool> fileExists, Func<string, string[]> listDir)
        {
            string dir = Path.Combine(home, "images");
            foreach (var n in new[] { "mtg-images.tar", "mtg-images.tar.gz", "mtg-images.tgz" })
                if (fileExists(Path.Combine(dir, n))) return Path.Combine(dir, n);
            foreach (var f in listDir(dir))
                if (Path.GetFileName(f).ToLowerInvariant().Contains(".tar")) return f;
            return null;
        }

        // ───────────────────────────── game lock ─────────────────────────────

        public static Game DecideGame(HttpResult state, double? resumeAgeSec)
        {
            bool fresh = resumeAgeSec.HasValue && resumeAgeSec.Value > -60 && resumeAgeSec.Value < 60;
            if (state.Kind == HttpKind.Ok && state.Status == 200)
            {
                object o = J.Parse(state.Body);
                if (!(o is Dictionary<string, object>))
                    return fresh ? Game.On("A game is on (the bridge's answer couldn't be read).", 0)
                                 : Game.CantTell("The bridge's answer couldn't be read.");
                bool started = J.Bool(o, "started");
                object[] seats = J.Arr(o, "seats");
                int turn = 0;
                if (seats != null) foreach (var s in seats) turn = Math.Max(turn, J.Int(s, "turn"));
                if (started) return Game.On("Game on: turn " + turn + ", " + (seats == null ? 0 : seats.Length) + " seats.", turn);
                if (seats != null)
                    return Game.On("A game is set up or just finished. Restarts unlock after it is cleared: type \"mtg reset\" in TTS chat.", turn);
                if (fresh) return Game.On("The bridge just restarted and is bringing a game back.", 0);
                return Game.None("No game.");
            }
            if (state.Kind == HttpKind.Refused)
                return fresh ? Game.On("A game was on a moment ago and the bridge stopped; it restarts by itself.", 0)
                             : Game.None("No game (the bridge isn't running).");
            return fresh ? Game.On("A game is on (the bridge is slow to answer).", 0)
                         : Game.CantTell("Can't tell whether a game is on: the bridge didn't answer (" + (state.Error ?? state.Kind.ToString()) + ").");
        }

        public static bool Locked(Game g) { return g == null || g.Kind != GameKind.None; }

        public static string LockText(Game g)
        {
            return g != null && g.Kind == GameKind.CantTell
                ? "Locked: can't tell whether a game is on. Try again in a minute."
                : "Locked: a game is on. Do this after the game.";
        }

        // ───────────────────────────── 1. Docker ─────────────────────────────

        public static Verdict DecideDocker(DockerFacts f)
        {
            if (f.Answers)
            {
                if (string.Equals(f.OsType, "windows", StringComparison.OrdinalIgnoreCase))
                    return new Verdict(Light.Red, "Docker is set to Windows containers. Right-click the Docker icon by the clock, choose \"Switch to Linux containers\", then press Try again.")
                        .WithFix(Fixes.Retry, "Try again");
                return new Verdict(Light.Green, "Running" + (f.Version != null ? " (Docker " + f.Version + (f.Cpus > 0 ? ", " + f.Cpus + " CPUs" : "") + ")" : "") + ".");
            }
            if (!f.CliFound && !f.DesktopFound)
                return new Verdict(Light.Red, "Install Docker Desktop, then press Try again. Get it from " + DockerUrl)
                    .WithFix(Fixes.Retry, "Try again")
                    .WithHint("Docker Desktop isn't installed on this PC.\r\nDownload it yourself from:\r\n    " + DockerUrl + "\r\nInstall it, start it once, accept its agreement, then press Try again.");
            if (!f.DesktopFound)
                return new Verdict(Light.Red, "Docker isn't answering and Docker Desktop.exe wasn't found. Start Docker yourself, then press Try again.")
                    .WithFix(Fixes.Retry, "Try again");
            if (f.Waiting)
            {
                if (f.WaitedSec >= 180)
                    return new Verdict(Light.Red, "Docker Desktop didn't answer within 3 minutes. Open its window and finish anything it asks (agreement, sign-in, a WSL update or a restart), then press the button.")
                        .WithFix(Fixes.DockerStart, "Start Docker Desktop");
                return new Verdict(Light.Busy, "Docker Desktop is starting (" + (int)f.WaitedSec + " s). If it opens a window asking for something, answer it.").WithAction(Actions.Wait);
            }
            if (f.DesktopRunning)
                return new Verdict(Light.Busy, "Docker Desktop is starting.").WithAction(Actions.Wait);
            return new Verdict(Light.Busy, "Starting Docker Desktop.").WithAction(Actions.StartDesktop);
        }

        // ───────────────────────────── 2. Engine images ─────────────────────────────

        // ids are compared without "sha256:", and a short id matches a long one it starts (12 hex at least)
        public static bool SameId(string a, string b)
        {
            if (string.IsNullOrEmpty(a) || string.IsNullOrEmpty(b)) return false;
            a = a.Trim().ToLowerInvariant(); b = b.Trim().ToLowerInvariant();
            if (a.StartsWith("sha256:")) a = a.Substring(7);
            if (b.StartsWith("sha256:")) b = b.Substring(7);
            if (a.Length < 12 || b.Length < 12) return a == b;
            return a.StartsWith(b) || b.StartsWith(a);
        }

        public static string ShortId(string id)
        {
            if (string.IsNullOrEmpty(id)) return "none";
            if (id.StartsWith("sha256:")) id = id.Substring(7);
            return id.Length > 8 ? id.Substring(0, 8) : id;
        }

        public static Verdict DecideImages(ImageFacts f)
        {
            bool relayOk = f.RelayId != null && (f.WantRelay == null || SameId(f.RelayId, f.WantRelay));
            bool nodeOk = f.NodeId != null && (f.WantNode == null || SameId(f.NodeId, f.WantNode));
            string ids = "relay " + ShortId(f.RelayId) + ", engine " + ShortId(f.NodeId);
            if (!f.Friend)
            {
                if (f.RelayId == null || f.NodeId == null)
                    return new Verdict(Light.Red, "The engine images aren't built. In Git Bash: bash engine/build-images.sh (about 20 minutes), then press Try again.")
                        .WithFix(Fixes.Retry, "Try again");
                if (!relayOk || !nodeOk)
                    return new Verdict(Light.Amber, "Present (" + ids + "), but not the images in stack\\deployed.json (node tools/deploy.js).");
                return new Verdict(Light.Green, "Present (" + ids + ").");
            }
            if (relayOk && nodeOk) return new Verdict(Light.Green, "Ready (" + ids + ").");
            bool bothThere = f.RelayId != null && f.NodeId != null;
            if (f.LoadedAlready)
            {
                if (bothThere)
                    return new Verdict(Light.Amber, "Loaded, but the image ids differ from this package's version.json (" + ids + "). Games may still work; tell whoever sent the package.");
                return new Verdict(Light.Red, "Loading the engine images didn't work. The log has Docker's message.")
                    .WithFix(Fixes.ImagesLoad, "Load the engine again");
            }
            if (f.TarPath == null)
                return new Verdict(Light.Red, "The engine file (images\\mtg-images.tar) is missing from the package. Unzip the package again, then press Try again.")
                    .WithFix(Fixes.Retry, "Try again");
            if (f.Locked && bothThere)
                return new Verdict(Light.Amber, "This package has a newer engine; it loads after the game.");
            return new Verdict(Light.Busy, (bothThere ? "Updating" : "Loading") + " the engine images (first run: a few minutes).").WithAction(Actions.Load);
        }

        // ───────────────────────────── 3. Engine stack ─────────────────────────────

        public static Verdict DecideStack(ContainerInfo relay, ContainerInfo room, LoginResult login, Game game)
        {
            if (relay == null || !relay.Exists)
                return new Verdict(Light.Red, "The engine isn't running (no relay container).").WithFix(Fixes.StackRestart, "Start the engine");
            if (relay.State != "running")
                return new Verdict(Light.Red, "The engine's relay is " + relay.State + ".").WithFix(Fixes.StackRestart, "Start the engine");
            if (room == null || !room.Exists || room.State != "running")
                return new Verdict(Light.Red, "The Forge room container isn't running.").WithFix(Fixes.StackRestart, "Start the engine");
            if (relay.Health == "starting") return new Verdict(Light.Busy, "The relay is starting.");
            if (relay.Health == "unhealthy")
                return new Verdict(Light.Red, "The relay's own health check fails.").WithFix(Fixes.StackRestart, "Restart relay and room");
            if (login == null || login.Kind == LoginKind.Skipped)
                return new Verdict(Light.Green, "Running" + (Locked(game) ? " (not probed during a game)" : "") + ".");
            switch (login.Kind)
            {
                case LoginKind.AuthFailed:
                    return new Verdict(Light.Red, "The relay refused the key (" + (login.Detail ?? "no reason") + "). Check MANABREW_SERVER_KEY in stack\\.env.")
                        .WithFix(Fixes.Retry, "Try again");
                case LoginKind.Ok:
                    if (!login.RoomFound) return new Verdict(Light.Busy, "The relay works; the Forge room isn't open yet.");
                    if (login.RoomStatus == "Lobby")
                        return new Verdict(Light.Green, "Ready: room " + Room + " is open (login " + login.Ms + " ms).");
                    if (Locked(game)) return new Verdict(Light.Green, "Ready: room " + Room + " is in a game.");
                    return new Verdict(Light.Red, "The room is busy with an earlier game, so a new start would be refused.")
                        .WithFix(Fixes.StackRestart, "Restart relay and room");
                default:
                    return new Verdict(Light.Red, "The relay is up, but this PC can't log in to it (" + login.Kind.ToString().ToLowerInvariant() + "), so games would fail at setup. This happens after Docker or WSL restarts.")
                        .WithFix(Fixes.StackRestart, "Restart relay and room");
            }
        }

        // `docker compose` output that names a port another program holds
        public static string ComposeFailure(string output)
        {
            if (output == null) return "Docker compose failed.";
            if (output.IndexOf("port is already allocated", StringComparison.OrdinalIgnoreCase) >= 0 || output.IndexOf("address already in use", StringComparison.OrdinalIgnoreCase) >= 0
                || output.IndexOf("Only one usage of each socket address", StringComparison.OrdinalIgnoreCase) >= 0)
                return "Port 9443 is taken, most likely by another copy of the MTG engine (e.g. the repo's \"stack\" containers). Stop that one first (Stop MTG.bat, or docker compose -p stack stop), then press the button.";
            if (output.IndexOf("pull access denied", StringComparison.OrdinalIgnoreCase) >= 0 || output.IndexOf("No such image", StringComparison.OrdinalIgnoreCase) >= 0)
                return "Docker can't find the engine images. Press Try again on the Engine images row.";
            string last = output.Trim().Split('\n').Select(s => s.Trim()).Where(s => s.Length > 0).LastOrDefault();
            return "Docker compose failed: " + (last ?? "no message") + ".";
        }

        // ───────────────────────────── 4. Table save ─────────────────────────────

        public static readonly Regex SaveName = new Regex(@"^TS_Save_(\d+)\.(json|png)$", RegexOptions.IgnoreCase);

        // What to do with the table save. Never writes over a file the app didn't install:
        //   - the file state.json says we installed: update it only when the package's save hash changed;
        //   - else a save byte-identical to ours: adopt it (no write);
        //   - else a new TS_Save_N.json with N past every number in use (.json or .png).
        public static SavePlan PlanSave(IList<SaveEntry> existing, InstallState st, string wantHash, string ourHash, long ourSize, Func<string, string> hashOf)
        {
            if (wantHash == null) wantHash = ourHash;
            var names = new HashSet<string>(existing.Select(e => e.Name), StringComparer.OrdinalIgnoreCase);
            if (st != null && !string.IsNullOrEmpty(st.SaveFile) && SaveName.IsMatch(st.SaveFile) && st.SaveFile.EndsWith(".json", StringComparison.OrdinalIgnoreCase))
            {
                if (names.Contains(st.SaveFile))
                {
                    if (st.SaveHash == wantHash) return new SavePlan(SaveKind.Skip, st.SaveFile, "Installed as " + st.SaveFile + " (up to date).");
                    return new SavePlan(SaveKind.Update, st.SaveFile, "Updating " + st.SaveFile + " to this package's table.");
                }
                // gone (the player deleted it): put it back under the same name, which is free
                return new SavePlan(SaveKind.Install, st.SaveFile, "Installing the table again as " + st.SaveFile + ".");
            }
            foreach (var e in existing)
            {
                if (!e.Name.EndsWith(".json", StringComparison.OrdinalIgnoreCase) || !SaveName.IsMatch(e.Name) || e.Size != ourSize) continue;
                if (hashOf(e.Name) == ourHash) return new SavePlan(SaveKind.Adopt, e.Name, "Already installed as " + e.Name + ".");
            }
            int max = 0;
            foreach (var n in names)
            {
                var m = SaveName.Match(n);
                if (m.Success) { int k; if (int.TryParse(m.Groups[1].Value, out k)) max = Math.Max(max, k); }
            }
            string file = "TS_Save_" + (max + 1) + ".json";
            return new SavePlan(SaveKind.Install, file, "Installing the table as " + file + ".");
        }

        // The save's own name, as TTS lists it
        public static string ReadSaveName(string json)
        {
            if (json == null) return null;
            var m = Regex.Match(json.Length > 4096 ? json.Substring(0, 4096) : json, "\"SaveName\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\"");
            if (!m.Success) return null;
            try { return (string)new JavaScriptSerializer().Deserialize("\"" + m.Groups[1].Value + "\"", typeof(string)); }
            catch { return m.Groups[1].Value; }
        }

        // ───────────────────────────── 5. Bridge ─────────────────────────────

        static readonly Regex BridgeArg = new Regex("(^|[\\s\"\\\\/])bridge\\.js([\"\\s]|$)", RegexOptions.IgnoreCase);

        // a node command line running a file named exactly bridge.js (not echo-bridge.js or a *-bridge.js fake)
        public static bool IsBridgeCommandLine(string cmd) { return cmd != null && BridgeArg.IsMatch(cmd); }

        static string Norm(string p) { return (p ?? "").Replace('/', '\\').ToLowerInvariant(); }

        // The programs holding the bridge's ports. ourBridgeJs: the package's bridge.js (friend mode), or null in home
        // mode, where any bridge.js counts as ours. Returns null when nothing is wrong.
        public static Verdict DecidePorts(IList<Listener> held, string ourBridgeJs)
        {
            foreach (var l in held)
            {
                if (l.Port != 39998 && l.Port != 48787) continue;
                bool isNode = string.Equals(l.Name, "node", StringComparison.OrdinalIgnoreCase) || string.Equals(l.Name, "node.exe", StringComparison.OrdinalIgnoreCase);
                if (isNode && l.CommandLine == null) continue; // can't tell: /versions decides
                if (isNode && IsBridgeCommandLine(l.CommandLine))
                {
                    if (ourBridgeJs == null || Norm(l.CommandLine).Contains(Norm(ourBridgeJs))) continue;
                    return new Verdict(Light.Red, "Another MTG bridge is already running (process " + l.Pid + ": " + Clip(l.CommandLine, 120) + "). Stop it first (in the repo: Stop MTG.bat), then press Try again.")
                        .WithFix(Fixes.Retry, "Try again");
                }
                string who = (l.Name ?? "a program") + (l.Name != null && !l.Name.EndsWith(".exe") ? ".exe" : "");
                return new Verdict(Light.Red, who + " (process " + l.Pid + ") is using port " + l.Port + ", which the bridge needs. This is usually the Tabletop Simulator extension in VS Code or Atom: close that program, then press Try again.")
                    .WithFix(Fixes.ShowProgram, "Show the program");
            }
            return null;
        }

        public static Verdict DecideBridge(HttpResult versions, Verdict portProblem, bool bridgeProcess, string wantBridge, bool friend)
        {
            if (portProblem != null) return portProblem;
            if (versions.Kind == HttpKind.Ok && versions.Status == 200)
            {
                string now = J.Str(J.Get(J.Parse(versions.Body), "now"), "bridge");
                if (wantBridge != null && now != null && now != wantBridge)
                    return new Verdict(Light.Amber, "Running, but it isn't " + (friend ? "this package's" : "the deployed") + " bridge (" + now + ", expected " + wantBridge + "). Restart it between games.")
                        .WithFix(Fixes.BridgeRestart, "Restart the bridge");
                return new Verdict(Light.Green, "Running (bridge " + (now ?? "?") + ").");
            }
            if (versions.Kind == HttpKind.Refused)
            {
                if (bridgeProcess) return new Verdict(Light.Busy, "The bridge is starting.").WithAction(Actions.Wait);
                return new Verdict(Light.Busy, "Starting the bridge.").WithAction(Actions.StartBridge);
            }
            return new Verdict(Light.Amber, "The bridge runs but didn't answer in time (" + (versions.Error ?? versions.Kind.ToString()) + "). It may be busy.")
                .WithFix(Fixes.BridgeRestart, "Restart the bridge");
        }

        // The hidden loop's restart line counts, from the bridge's log
        public static int CountExits(string logTail)
        {
            if (logTail == null) return 0;
            return Regex.Matches(logTail, @"\[bridge exited with code").Count;
        }

        // ───────────────────────────── 6. TTS ─────────────────────────────

        public static string TtsHowTo(string saveName)
        {
            return "In TTS: Create → Singleplayer (or Multiplayer) → Games → Save & Load → " + (saveName ?? DefaultSaveName);
        }

        public static Verdict DecideTts(TtsFacts f)
        {
            string how = TtsHowTo(f.SaveName);
            if (!f.Running)
            {
                if (!f.SteamFound)
                    return new Verdict(Light.Amber, "Steam wasn't found. Install Steam and Tabletop Simulator, then press Open TTS.").WithFix(Fixes.TtsOpen, "Open TTS");
                return new Verdict(Light.Amber, "Tabletop Simulator isn't running.").WithFix(Fixes.TtsOpen, "Open TTS").WithHint(how);
            }
            if (!f.VersionsOk) return new Verdict(Light.Amber, "TTS is running. The table can be checked once the bridge runs.").WithHint(how);
            if (!f.TableHeard) return new Verdict(Light.Amber, "TTS is running. Load the table: " + how + ".").WithHint(how);
            if (f.Table == null) return new Verdict(Light.Red, "Old table loaded (it has no version): load " + (f.SaveName ?? DefaultSaveName) + " again.").WithHint(how);
            if (f.Table == "dev") return new Verdict(Light.Amber, "Connected; the table was built from source, not deployed.");
            if (f.WantTable != null && f.Table != f.WantTable)
                return new Verdict(Light.Red, "Old table loaded (" + f.Table + ", this " + (f.Home ? "deploy" : "package") + " has " + f.WantTable + "): load " + (f.SaveName ?? DefaultSaveName) + " again.").WithHint(how);
            return new Verdict(Light.Green, "Connected: table " + f.Table + " is loaded.");
        }

        // ───────────────────────────── WSL limits (optional button) ─────────────────────────────

        // Sets processors= and memory= in the [wsl2] section, keeping every other line and the file's line ends
        public static string SetWslLimits(string text, int cores, string memory)
        {
            string nl = text != null && text.Contains("\r\n") ? "\r\n" : (text != null && text.Contains("\n") ? "\n" : "\r\n");
            var lines = new List<string>(string.IsNullOrEmpty(text) ? new string[0] : text.Replace("\r\n", "\n").Split('\n'));
            if (lines.Count > 0 && lines[lines.Count - 1] == "") lines.RemoveAt(lines.Count - 1);
            int start = lines.FindIndex(s => s.Trim().Equals("[wsl2]", StringComparison.OrdinalIgnoreCase));
            if (start < 0)
            {
                if (lines.Count > 0 && lines[lines.Count - 1].Trim() != "") lines.Add("");
                lines.Add("[wsl2]");
                lines.Add("processors=" + cores);
                lines.Add("memory=" + memory);
                return string.Join(nl, lines) + nl;
            }
            int end = start + 1;
            while (end < lines.Count && !lines[end].Trim().StartsWith("[")) end++;
            bool gotP = false, gotM = false;
            for (int i = start + 1; i < end; i++)
            {
                string k = lines[i].Split('=')[0].Trim().ToLowerInvariant();
                if (k == "processors") { lines[i] = "processors=" + cores; gotP = true; }
                else if (k == "memory") { lines[i] = "memory=" + memory; gotM = true; }
            }
            int at = start + 1;
            if (!gotM) lines.Insert(at, "memory=" + memory);
            if (!gotP) lines.Insert(at, "processors=" + cores);
            return string.Join(nl, lines) + nl;
        }

        // ───────────────────────────── small helpers ─────────────────────────────

        public static string Sha8(byte[] data)
        {
            using (var sha = SHA256.Create())
            {
                var h = sha.ComputeHash(data);
                var sb = new StringBuilder();
                for (int i = 0; i < 4; i++) sb.Append(h[i].ToString("x2"));
                return sb.ToString();
            }
        }

        public static string Clip(string s, int n) { if (s == null) return ""; return s.Length <= n ? s : s.Substring(0, n) + "…"; }

        // `docker compose` arguments for this layout's project and file
        public static string ComposeArgs(Layout l, string rest)
        {
            return "compose -p " + l.Project + " -f \"" + l.ComposeFile + "\" " + rest;
        }

        // The relay key: MANABREW_SERVER_KEY in stack\.env, else the compose default
        public static string RelayKey(string envText)
        {
            if (envText != null)
                foreach (var line in envText.Replace("\r", "").Split('\n'))
                {
                    var t = line.Trim();
                    if (t.StartsWith("MANABREW_SERVER_KEY="))
                    {
                        var v = t.Substring("MANABREW_SERVER_KEY=".Length).Trim().Trim('"', '\'');
                        if (v.Length > 0) return v;
                    }
                }
            return "tts-local";
        }

        public static Light Worst(IEnumerable<Light> lights)
        {
            Light w = Light.Green;
            bool any = false, grey = true;
            foreach (var l in lights)
            {
                any = true;
                if (l != Light.Grey) grey = false;
                if (Rank(l) > Rank(w)) w = l;
            }
            if (!any || grey) return Light.Grey;
            return w;
        }

        static int Rank(Light l) { return l == Light.Red ? 4 : l == Light.Amber ? 3 : l == Light.Busy ? 2 : l == Light.Green ? 1 : 0; }
    }

    // ───────────────────────────── fact types ─────────────────────────────

    public enum GameKind { None, On, CantTell }

    public class Game
    {
        public GameKind Kind; public string Text; public int Turn;
        public static Game On(string t, int turn) { return new Game { Kind = GameKind.On, Text = t, Turn = turn }; }
        public static Game None(string t) { return new Game { Kind = GameKind.None, Text = t }; }
        public static Game CantTell(string t) { return new Game { Kind = GameKind.CantTell, Text = t }; }
    }

    public enum HttpKind { Ok, Refused, Timeout, Error }

    public class HttpResult
    {
        public HttpKind Kind; public int Status; public string Body; public long Ms; public string Error;
        public static HttpResult Ok(string body) { return new HttpResult { Kind = HttpKind.Ok, Status = 200, Body = body }; }
        public static HttpResult Of(HttpKind k) { return new HttpResult { Kind = k, Error = k.ToString().ToLowerInvariant() }; }
    }

    public class DockerFacts
    {
        public bool CliFound, DesktopFound, Answers, DesktopRunning, Waiting;
        public string OsType, Version; public int Cpus; public double WaitedSec;
    }

    public class ImageFacts
    {
        public bool Friend, LoadedAlready, Locked;
        public string RelayId, NodeId, WantRelay, WantNode, TarPath;
    }

    public class ContainerInfo
    {
        public bool Exists; public string Id, Name, State, Health, Image; public int Restarts;
    }

    public enum LoginKind { Ok, Refused, Closed, AuthFailed, Timeout, Error, Skipped }

    public class LoginResult
    {
        public LoginKind Kind; public bool RoomFound; public string RoomStatus; public long Ms; public string Detail;
    }

    public class Listener { public int Port; public int Pid; public string Name; public string CommandLine; }

    public class TtsFacts
    {
        public bool Running, VersionsOk, TableHeard, SteamFound, Home;
        public string Table, WantTable, SaveName;
    }

    public class SaveEntry { public string Name; public long Size; public SaveEntry(string n, long s) { Name = n; Size = s; } }

    public class InstallState { public string SaveFile, SaveHash, SavesDir; }

    public enum SaveKind { Skip, Adopt, Install, Update }

    public class SavePlan
    {
        public SaveKind Kind; public string File; public string Text;
        public SavePlan(SaveKind k, string f, string t) { Kind = k; File = f; Text = t; }
        public override string ToString() { return Kind + " " + File; }
    }

    // A few accessors over JavaScriptSerializer's Dictionary/object[] output
    public static class J
    {
        static JavaScriptSerializer Ser() { var s = new JavaScriptSerializer(); s.MaxJsonLength = int.MaxValue; s.RecursionLimit = 256; return s; }
        public static object Parse(string s) { if (string.IsNullOrEmpty(s)) return null; try { return Ser().DeserializeObject(s); } catch { return null; } }
        public static string Write(object o) { return Ser().Serialize(o); }
        public static bool Has(object o, string k) { var d = o as Dictionary<string, object>; return d != null && d.ContainsKey(k); }
        public static object Get(object o, string k) { var d = o as Dictionary<string, object>; object v; return d != null && d.TryGetValue(k, out v) ? v : null; }
        public static string Str(object o, string k) { var v = Get(o, k); return v == null ? null : Convert.ToString(v, System.Globalization.CultureInfo.InvariantCulture); }
        public static bool Bool(object o, string k) { var v = Get(o, k); return v is bool && (bool)v; }
        public static int Int(object o, string k) { var v = Get(o, k); try { return v == null ? 0 : Convert.ToInt32(v); } catch { return 0; } }
        public static object[] Arr(object o, string k) { var v = Get(o, k); var a = v as object[]; if (a != null) return a; var l = v as System.Collections.ArrayList; return l != null ? l.ToArray() : null; }
    }
}
