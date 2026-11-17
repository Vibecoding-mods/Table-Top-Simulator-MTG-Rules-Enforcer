// Own-server mode, the pure part (docs/companion-app-spec.md §5.8): the engine (relay and Forge room) runs on another
// computer, the host's, and this companion connects to it over the network instead of running Docker here. The same
// rules as the Linux/Mac companion (companion-node/logic.js serverSetting, parseServer, decideServer), so one
// server.json works for both. No I/O here: --selftest feeds canned inputs (SelfTest.cs OwnServerChecks).
// C# 5 only (csc 4.8): no $"", no ?., no => members, no nameof, no out var.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

namespace MtgCompanion
{
    // one server: where its relay listens and the key it takes
    public class ServerConfig
    {
        public string Host; public int Port; public string Key; public bool Secure;
    }

    // the server this run uses: Ok with Server, or a problem in words (NoKey: only the key is missing)
    public class ServerSetting
    {
        public bool Ok; public string Problem; public bool NoKey; public ServerConfig Server;
        public static ServerSetting Bad(string problem) { return new ServerSetting { Ok = false, Problem = problem }; }
    }

    public static class OwnServer
    {
        public const string File = "server.json";          // in the package folder (home mode: the repo's root)
        public const int DefaultPort = 9443;               // the relay's port in stack/compose.yml
        public const string KeyVariable = "MTG_SERVER_KEY"; // a key that server.json leaves out
        public const string RowName = "Your server";       // the Engine stack row's name in this mode
        static readonly string[] Keys = { "host", "port", "key", "secure" };

        // a host name (underscores and a trailing dot allowed, as DNS names have them), an IPv4 address or a bracketed
        // IPv6 one; nothing else (no scheme, path, user or spaces). null: fine
        static readonly Regex Scheme = new Regex(@"^[a-z][a-z0-9+.-]*://", RegexOptions.IgnoreCase);
        static readonly Regex V6 = new Regex(@"^\[[0-9a-f:.]+\]$", RegexOptions.IgnoreCase);
        static readonly Regex Name = new Regex(@"^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*\.?$", RegexOptions.IgnoreCase);
        public static string HostProblem(object h)
        {
            var s = h as string;
            if (s == null || s.Trim().Length == 0) return "\"host\" is missing: give the server's name or address, e.g. \"mtg.example.org\".";
            var host = s.Trim();
            if (Scheme.IsMatch(host)) return "\"host\" is \"" + host + "\": give the name only, without ws:// or http:// (the port goes in \"port\").";
            if (V6.IsMatch(host)) return null;
            if (host.Length > 254 || !Name.IsMatch(host))
                return "\"host\" is \"" + host + "\", which isn't a server name or address (letters, digits, dots, dashes and underscores; an IPv6 address in [brackets]).";
            return null;
        }

        // one setting object (server.json's, or --server's) -> Ok with the server (its key may still be null), or why not
        public static ServerSetting Parse(object o)
        {
            var d = o as Dictionary<string, object>;
            if (d == null) return ServerSetting.Bad("it isn't a JSON object like { \"host\": \"mtg.example.org\" }.");
            var unknown = d.Keys.Where(k => !Keys.Contains(k)).ToList();
            if (unknown.Count > 0)
                return ServerSetting.Bad("unknown setting" + (unknown.Count > 1 ? "s " : " ") + string.Join(", ", unknown.Select(k => "\"" + k + "\"")) + " (the settings are " + string.Join(", ", Keys.Select(k => "\"" + k + "\"")) + ").");
            object host; d.TryGetValue("host", out host);
            var hp = HostProblem(host);
            if (hp != null) return ServerSetting.Bad(hp);
            int port = DefaultPort;
            object p;
            if (d.TryGetValue("port", out p) && p != null)
            {
                int n;
                if (!PortOf(p, out n)) return ServerSetting.Bad("\"port\" is " + J.Write(p) + ": a number from 1 to 65535 (the relay's is " + DefaultPort + " unless you changed it).");
                port = n;
            }
            object key; d.TryGetValue("key", out key);
            if (key != null && (!(key is string) || ((string)key).Trim().Length == 0)) return ServerSetting.Bad("\"key\" must be the server's key as text (or left out).");
            object secure; d.TryGetValue("secure", out secure);
            if (secure != null && !(secure is bool)) return ServerSetting.Bad("\"secure\" must be true or false (true: the server's relay is behind TLS, wss://).");
            return new ServerSetting { Ok = true, Server = new ServerConfig {
                Host = ((string)host).Trim().ToLowerInvariant(), Port = port, Key = key == null ? null : ((string)key).Trim(), Secure = secure is bool && (bool)secure } };
        }

        // a port as a JSON number or a string of digits, 1 to 65535
        static bool PortOf(object p, out int port)
        {
            port = 0;
            long n;
            if (p is string)
            {
                var t = ((string)p).Trim();
                if (t.Length == 0 || !t.All(char.IsDigit) || !long.TryParse(t, NumberStyles.None, CultureInfo.InvariantCulture, out n)) return false;
            }
            else if (p is int || p is long) n = Convert.ToInt64(p);
            else if (p is decimal || p is double) { var x = Convert.ToDouble(p); if (x != Math.Floor(x)) return false; n = (long)x; }
            else return false;
            if (n < 1 || n > 65535) return false;
            port = (int)n;
            return true;
        }

        // "host[:port]" (--server) as a setting object, or null when it is empty
        static readonly Regex Spec = new Regex(@"^(\[[^\]]+\]|[^:\s]+)(?::(\d+))?$");
        public static Dictionary<string, object> SpecOf(string spec)
        {
            if (spec == null || spec.Trim().Length == 0) return null;
            var t = spec.Trim();
            var m = Spec.Match(t);
            var d = new Dictionary<string, object>();
            if (!m.Success) { d["host"] = t; return d; }
            d["host"] = m.Groups[1].Value;
            if (m.Groups[2].Success) d["port"] = m.Groups[2].Value;
            return d;
        }

        // the same server name: case and a trailing dot don't count
        public static bool SameHost(object a, object b)
        {
            var x = a as string; var y = b as string;
            return x != null && y != null && x.Trim().ToLowerInvariant().TrimEnd('.') == y.Trim().ToLowerInvariant().TrimEnd('.');
        }

        // The server this run uses: null (the engine on this computer), or the setting, which must have a key.
        // fileText: server.json (null: no file); spec: --server (null: none); envKey: MTG_SERVER_KEY.
        public static ServerSetting SettingOf(string fileText, string spec, string envKey)
        {
            bool hasFile = fileText != null;
            Dictionary<string, object> fromFile = null;
            if (hasFile)
            {
                // (a UTF-8 BOM, as Notepad writes one, isn't JSON; any JSON value counts, so false or 0 is an error, never "no file")
                var text = fileText.TrimStart('﻿');
                object parsed = null;
                bool valid = true;
                try { parsed = new System.Web.Script.Serialization.JavaScriptSerializer().DeserializeObject(text); } catch { valid = false; }
                // (a cut-off object, "{\"host\": ", which a lenient reader takes for an object, is no JSON either)
                if (valid && parsed is Dictionary<string, object> && !text.Trim().EndsWith("}")) valid = false;
                if (!valid || text.Trim().Length == 0)
                    return ServerSetting.Bad(File + " isn't valid JSON. Write it like { \"host\": \"mtg.example.org\", \"port\": 9443, \"key\": \"...\" }, or delete it to run the engine on this computer.");
                fromFile = parsed as Dictionary<string, object>;
                if (fromFile == null) return ServerSetting.Bad(File + ": " + Parse(parsed).Problem);
            }
            var cli = SpecOf(spec);
            if (!hasFile && cli == null) return null;
            // --server naming another host than server.json's: none of the file's settings are for it (above all its key)
            object fileHost = null;
            if (fromFile != null) fromFile.TryGetValue("host", out fileHost);
            bool otherHost = cli != null && fromFile != null && !SameHost(cli["host"], fileHost);
            var merged = new Dictionary<string, object>();
            if (fromFile != null && !otherHost) foreach (var kv in fromFile) merged[kv.Key] = kv.Value;
            if (cli != null) foreach (var kv in cli) merged[kv.Key] = kv.Value;
            var r = Parse(merged);
            if (!r.Ok) return ServerSetting.Bad((cli != null ? "--server" : File) + ": " + r.Problem);
            if (r.Server.Key == null && envKey != null && envKey.Trim().Length > 0) r.Server.Key = envKey.Trim();
            // (never this package's own key: that one is for the engine on this computer, and a server must not be sent it)
            if (r.Server.Key == null)
            {
                var bad = ServerSetting.Bad(otherHost
                    ? "--server " + r.Server.Host + ": no key for this server (" + File + "'s key is for " + Convert.ToString(fileHost).Trim() + ", so it isn't sent to another server). Set " + KeyVariable + " to this server's key (its MANABREW_SERVER_KEY), or put this server in " + File + "."
                    : "no key for your server (" + Words(r.Server) + "). Put the server's key (its MANABREW_SERVER_KEY, in the server's stack/.env) in " + File + " as \"key\", or set " + KeyVariable + ".");
                bad.NoKey = true;
                return bad;
            }
            return r;
        }

        public static string Url(ServerConfig s) { return (s.Secure ? "wss" : "ws") + "://" + s.Host + ":" + s.Port; }
        public static string Words(ServerConfig s) { return s.Host + ":" + s.Port; }

        // steps 1 and 2 with a server: nothing to run on this computer
        public static Verdict NotNeeded(ServerConfig s) { return new Verdict(Light.Green, "Not needed here: the engine runs on your server (" + Words(s) + ")."); }
        // steps 1 and 2 while the server setting has a problem: the server row says what
        public static Verdict WaitingForSetting() { return new Verdict(Light.Grey, "Not needed here once your server setting is right (see " + RowName + ")."); }

        // The start light with a server: whether it answers, from one relay login (Probes.RelayLogin; Skipped during a
        // game). Red lights say what to check and have Try again.
        public static Verdict Decide(ServerSetting setting, LoginResult login, Game game, string wantBuild = null)
        {
            if (setting == null || !setting.Ok)
                return new Verdict(Light.Red, "Own server: " + (setting == null ? "no server set." : setting.Problem)).WithFix(Fixes.Retry, "Try again").WithHint(Help);
            var s = setting.Server; var at = Words(s);
            if (login == null || login.Kind == LoginKind.Skipped)
                return new Verdict(Light.Green, "Your server (" + at + ")" + (Logic.Locked(game) ? ": not probed during a game" : "") + ".");
            var why = login.Detail != null ? " (" + Logic.Clip(login.Detail, 120) + ")" : "";
            Verdict v;
            switch (login.Kind)
            {
                case LoginKind.Ok:
                    if (!login.RoomFound)
                        v = new Verdict(Light.Red, "Connected to your server (" + at + "), but its Forge room (" + Logic.Room + ") isn't open. Start the Forge room on the server, then press Try again.");
                    else if (login.RoomStatus == "Lobby" || Logic.Locked(game))
                    {
                        var warn = EngineBuildWarning(login.EngineBuild, wantBuild);
                        if (warn != null) return new Verdict(Light.Amber, warn).WithFix(Fixes.Retry, "Try again").WithHint(Help);
                        return new Verdict(Light.Green, login.RoomStatus == "Lobby"
                            ? "Your server answers (" + at + "): room " + Logic.Room + " is open (login " + login.Ms + " ms)."
                            : "Your server answers (" + at + "): room " + Logic.Room + " is in a game.");
                    }
                    else
                        v = new Verdict(Light.Red, "Your server's room (" + at + ") is busy with an earlier game, so a new start would be refused. Restart the relay and the Forge room on the server.");
                    break;
                case LoginKind.AuthFailed:
                    v = new Verdict(Light.Red, "Your server (" + at + ") refused the key" + why + ". Put the server's key (its MANABREW_SERVER_KEY) in " + File + " as \"key\" (it is encrypted for your Windows account on the next start).");
                    break;
                case LoginKind.Refused:
                    v = new Verdict(Light.Red, "Your server (" + at + ") refused the connection" + why + ": nothing listens on port " + s.Port + " there. Check the port and that the engine runs on the server.");
                    break;
                case LoginKind.NotFound:
                    v = new Verdict(Light.Red, "Your server's name \"" + s.Host + "\" isn't known" + why + ": it doesn't resolve to an address. Check its spelling (or use the server's IP address).");
                    break;
                case LoginKind.Timeout:
                    v = new Verdict(Light.Red, "Your server (" + at + ") didn't answer" + why + ". Check that it is on, that its firewall lets port " + s.Port + " in from this computer, and the address.");
                    break;
                default:
                    v = new Verdict(Light.Red, "Can't reach your server (" + at + ")" + why + ". Check the address, that the server is on, and that port " + s.Port + " is open to this computer" + (s.Secure ? " (secure needs TLS on the server)" : "") + ".");
                    break;
            }
            return v.WithFix(Fixes.Retry, "Try again").WithHint(Help);
        }

        public const string Help = "Own server: the engine runs on the host's computer, and this companion connects to it.\n1. Both computers join the same Tailscale network; the host runs the engine (tools/setup-server.sh) and gives you its Tailscale address and key.\n2. Write server.json in this package's folder: { \"host\": \"100.64.0.5\", \"key\": \"...\" } (the key is encrypted for your Windows account on the next start), or start the companion with --server.\n3. Delete server.json to go back to the engine in Docker here.";

        // What a running bridge's GET /versions says it connects to: { relay, remote }, or null for a bridge too old to say
        public static bool BridgeRelay(string versionsBody, out string relay, out bool remote)
        {
            var o = J.Parse(versionsBody);
            relay = J.Str(o, "relay"); remote = J.Bool(o, "remoteEngine");
            return J.Has(o, "relay");
        }

        // A running bridge connects to another engine than this run's: with a server, any relay but the server's (or a
        // bridge too old to say); without one, a bridge that runs for a server
        public static bool RelayDiffers(string versionsBody, ServerConfig server)
        {
            string relay; bool remote;
            bool says = BridgeRelay(versionsBody, out relay, out remote);
            if (server != null) return !says || relay != Url(server) || !remote;
            return says && remote;
        }

        // The bridge row when it runs for another engine: amber, its restart starts it for this one
        public static Verdict BridgeForOtherEngine(ServerConfig server)
        {
            return new Verdict(Light.Amber, server != null
                ? "The bridge runs for another engine, not your server (" + Words(server) + "). Restart the bridge to use your server."
                : "The bridge runs for a server, not the engine on this computer. Restart the bridge to use this computer's engine.")
                .WithFix(Fixes.BridgeRestart, "Restart the bridge");
        }

        // The bridge's environment for this run: with a server, its relay, key and MTG_REMOTE_ENGINE=1 (bridge.js reads
        // them); without one, the three emptied, so a variable left in the environment never points it elsewhere
        public static Dictionary<string, string> BridgeEnv(ServerConfig server)
        {
            return server == null
                ? new Dictionary<string, string> { { "MTG_RELAY", "" }, { "MTG_KEY", "" }, { "MTG_REMOTE_ENGINE", "" } }
                : new Dictionary<string, string> { { "MTG_RELAY", Url(server) }, { "MTG_KEY", server.Key }, { "MTG_REMOTE_ENGINE", "1" } };
        }

        // ── the key at rest (KeyVault.cs): server.json keeps it encrypted, never as plain text

        // server.json as stored -> the text SettingOf reads (an encrypted key opened into "key"). resave: the file's new
        // text when it held a plain key (the key encrypted; null: nothing to save). problem: an encrypted key this account
        // can't open (null: none). protect/unprotect: KeyVault's (the self-test passes its own). Text that isn't a JSON
        // object is handed on as it is: SettingOf says what is wrong with it.
        public static string OpenKey(string fileText, Func<string, string> unprotect, Func<string, string> protect, out string resave, out string problem)
        {
            resave = null; problem = null;
            if (fileText == null) return null;
            var text = fileText.TrimStart('\uFEFF');
            Dictionary<string, object> d = null;
            try { d = new System.Web.Script.Serialization.JavaScriptSerializer().DeserializeObject(text) as Dictionary<string, object>; } catch { d = null; }
            if (d == null || !text.Trim().EndsWith("}")) return fileText;
            object plain, sealedKey;
            d.TryGetValue("key", out plain); d.TryGetValue(KeyVault.Field, out sealedKey);
            if (plain is string && ((string)plain).Trim().Length > 0)
            {
                // (a key typed into the file wins over an older encrypted one: it is the one the player means now)
                var stored = new Dictionary<string, object>();
                foreach (var kv in d)
                {
                    if (kv.Key == KeyVault.Field) continue;
                    if (kv.Key == "key")
                    {
                        string blob = null;
                        try { blob = protect(((string)plain).Trim()); } catch { blob = null; }
                        if (blob == null) { stored = null; break; }
                        stored[KeyVault.Field] = blob;
                    }
                    else stored[kv.Key] = kv.Value;
                }
                if (stored != null) resave = J.Write(stored);
                var used = new Dictionary<string, object>(d);
                used.Remove(KeyVault.Field);
                return J.Write(used);
            }
            if (sealedKey == null) return fileText;
            string key = null;
            try { key = sealedKey is string ? unprotect((string)sealedKey) : null; } catch { key = null; }
            if (key == null || key.Trim().Length == 0)
            {
                problem = File + "'s key was saved encrypted for another Windows account or PC, so it can't be read here. Put the server's key in " + File + " again as \"key\": it is encrypted for you on the next start.";
                return null;
            }
            var opened = new Dictionary<string, object>();
            foreach (var kv in d) { if (kv.Key == KeyVault.Field) opened["key"] = key; else opened[kv.Key] = kv.Value; }
            return J.Write(opened);
        }

        // The server's engine build against the one this table was deployed with (version.json / stack/deployed.json
        // engineBuild): words for the warning, or null when they match or either is unknown (an older server or deploy)
        public static string EngineBuildWarning(string have, string want)
        {
            if (string.IsNullOrEmpty(have) || string.IsNullOrEmpty(want) || have == want) return null;
            return "Your server runs engine " + have + ", but this table was deployed with engine " + want + ". They may not work together: ask the host to update the server, or update this package.";
        }
    }
}
