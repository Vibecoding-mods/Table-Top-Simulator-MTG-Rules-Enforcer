// Break-it for the Windows companion's own-server mode (tests/test_companion_own_server.js, tests/test_friend_package.js;
// companion/src/OwnServer.cs and KeyVault.cs and their wiring, the page without a box, the friend README and the
// packager's key check).
// Each mutation changes one rule and needs the check it names to fail:
//  - companion/src/*.cs and WebPage.cs: the source folder is copied to a temp folder, the copy is changed and built
//    (build.cmd's csc on Windows, mono's mcs elsewhere), and the test runs that exe (COMPANION_EXE) and page
//    (COMPANION_PAGE). The real sources are never written.
//  - tools/make-friend-package.js: changed in place for the run of tests/test_friend_package.js, then put back and
//    checked by sha256 (the test requires the file by its path).
// A mutation whose check doesn't fail is printed as SURVIVED, except where it is marked an equivalent program on this
// platform (equivalentOn, with why): then EQUIVALENT, with the reason, counted apart.
// The live relay on this PC's 9443 may answer a mutant that logs in there: the checks that need the fake relay's own
// login say so (2026-11-17, Windows: "the login made on this PC with a server" showed the same green text).
//   node tools/mutate-companion-own-server.js [label pattern]
require("./restore-on-interrupt"); // (the in-place source file is put back on exit or Ctrl+C, 2026-11-27)
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "companion", "src");
const WIN = process.platform === "win32";
const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const O = "companion/src/OwnServer.cs", C = "companion/src/Controller.cs", P = "companion/src/Probes.cs", W = "companion/src/WebPage.cs", F = "tools/make-friend-package.js";
const K = "companion/src/KeyVault.cs", U = "companion/src/WebUi.cs";
const OWN = "tests/test_companion_own_server.js", PKG = "tests/test_friend_package.js";
// [label, file, from, to, the check that must fail]: `from` must occur exactly once
const MUTATIONS = [
  ["the default port 9444", O, "public const int DefaultPort = 9443;", "public const int DefaultPort = 9444;", "selftest: server: host only, the default port 9443, lower case"],
  ["a ws:// host accepted", O, "if (Scheme.IsMatch(host)) return", "if (false) return", "selftest: server: refused (without ws://)"],
  ["a misspelt setting ignored", O, "if (unknown.Count > 0)", "if (false)", "selftest: server: refused (unknown setting \"prot\")"],
  ["a cut-off server.json taken as an object", O, "if (valid && parsed is Dictionary<string, object> && !text.Trim().EndsWith(\"}\")) valid = false;", "", "selftest: server: refused (isn't valid JSON)",
    { equivalentOn: "win32", why: ".NET Framework's JavaScriptSerializer itself rejects an object cut off before its \"}\" (mono's takes it for an object), so on Windows the check never changes a result" }],
  ["MTG_SERVER_KEY beats server.json's key", O, "if (r.Server.Key == null && envKey != null && envKey.Trim().Length > 0)", "if (envKey != null && envKey.Trim().Length > 0)", "selftest: server: server.json's key beats MTG_SERVER_KEY"],
  ["--server's other host gets the file's key", O, "bool otherHost = cli != null && fromFile != null && !SameHost(cli[\"host\"], fileHost);", "bool otherHost = false;", "selftest: server: --server for another host never gets the file's key"],
  ["secure ignored", O, "(s.Secure ? \"wss\" : \"ws\")", "\"ws\"", "selftest: server: a port, secure, and Notepad's BOM"],
  ["a busy room counted as ours", O, "else if (login.RoomStatus == \"Lobby\" || Logic.Locked(game))", "else if (true)", "a busy room: red, says so"],
  ["the refused message made generic", O, "refused the connection\" + why + \": nothing listens on port \" + s.Port + \" there.", "refused the connection\" + why + \".", "nothing on the port: red, nothing listens"],
  ["the key never sent to the bridge", O, "{ \"MTG_KEY\", server.Key }", "{ \"MTG_KEY\", \"\" }", "selftest: bridge: started with the server's relay, key and MTG_REMOTE_ENGINE=1"],
  ["this computer's engine leaves the server variables", O, "? new Dictionary<string, string> { { \"MTG_RELAY\", \"\" }, { \"MTG_KEY\", \"\" }, { \"MTG_REMOTE_ENGINE\", \"\" } }", "? new Dictionary<string, string>()", "selftest: bridge: this computer's engine empties the three"],
  ["a bridge too old to say counted as the server's", O, "if (server != null) return !says || relay != Url(server) || !remote;", "if (server != null) return says && relay != Url(server);", "selftest: bridge: one too old to say differs from a server"],
  ["a name that doesn't resolve not told apart", P, "se != null && (se.SocketErrorCode == SocketError.HostNotFound || se.SocketErrorCode == SocketError.NoData || se.SocketErrorCode == SocketError.TryAgain) ? LoginKind.NotFound", "false ? LoginKind.NotFound", "selftest: login kind: mono's unknown name (SocketException HostNotFound): isn't known"],
  ["Windows' unknown name not told apart", P, "                 : NameFailure(e) ? LoginKind.NotFound\n", "", "selftest: login kind: Windows' unknown name (WebException NameResolutionFailure): isn't known"],
  ["any WebException taken as an unknown name", P, "if (w != null && w.Status == WebExceptionStatus.NameResolutionFailure) return true;", "if (w != null) return true;", "selftest: login kind: another WebException: closed, not isn't known"],
  ["a refused connection not told apart", P, "se.SocketErrorCode == SocketError.ConnectionRefused ? LoginKind.Refused", "false ? LoginKind.Refused", "selftest: login kind: a refused connection: refused"],
  ["a cancelled connect not a timeout", P, "(Inner(e) is OperationCanceledException || Inner(e) is TaskCanceledException) ? LoginKind.Timeout", "false ? LoginKind.Timeout", "selftest: login kind: cancelled: timeout"],
  ["Docker still asked with a server", C, "case StepDocker: ok = OnServer ? NotHere(StepDocker) : DoDocker(); break;", "case StepDocker: ok = DoDocker(); break;", "selftest: wiring: with a server the start steps ask nothing of Docker: Not needed here"],
  ["the login made on this PC with a server", C, "var r = s != null && s.Ok ? Probes.RelayLogin(OwnServer.Url(s.Server)", "var r = false ? Probes.RelayLogin(OwnServer.Url(s.Server)", "server answers: green, Your server, the room open"],
  ["the bridge loop without the engine's variables", C, "            foreach (var kv in EngineEnv()) psi.EnvironmentVariables[kv.Key] = kv.Value;\n", "", "selftest: wiring: the bridge loop gets the server's relay, key and MTG_REMOTE_ENGINE=1"],
  ["the row keeps its Engine stack name", C, "Rows[StepStack].Name = server != null ? OwnServer.RowName : Names[StepStack];", "Rows[StepStack].Name = Names[StepStack];", "selftest: wiring: server.json makes the Engine stack row Your server"],
  // the key at rest (DPAPI)
  ["a plain key not saved again encrypted", C, "if (resave != null && !Observe)", "if (false)", "selftest: wiring: the plain key in server.json is saved again encrypted for this account"],
  ["an encryption failure not logged", C, "if (protectError != null && !Observe) Log.Write(", "if (false) Log.Write(", "selftest: wiring: encryption failing is logged once (no key), the file kept, the server still used"],
  ["observe mode writes the encrypted file", C, "if (resave != null && !Observe)", "if (resave != null)", "selftest: wiring: observe mode leaves a plain key as it is (nothing written)"],
  ["the plain key kept beside the encrypted one", O, "                        stored[KeyVault.Field] = blob;\n", "                        stored[KeyVault.Field] = blob; stored[\"key\"] = plain;\n", "selftest: key: and the file is saved again with it encrypted, never plain"],
  ["a typed key loses to the old encrypted one", O, "if (plain is string && ((string)plain).Trim().Length > 0)", "if (sealedKey == null && plain is string && ((string)plain).Trim().Length > 0)", "selftest: key: a key typed beside an encrypted one wins, and replaces it encrypted"],
  ["another account's key not said", O, "                problem = File + \"'s key was saved encrypted", "                problem = null; var unsaid = File + \"'s key was saved encrypted", "selftest: key: another account's encrypted key: a problem that says to put the key in again"],
  ["the encrypted key not opened", O, "foreach (var kv in d) { if (kv.Key == KeyVault.Field) opened[\"key\"] = key; else opened[kv.Key] = kv.Value; }", "foreach (var kv in d) opened[kv.Key] = kv.Value;", "selftest: key: the encrypted file opens to the same key, and isn't saved again"],
  ["DPAPI for the machine, not the account", K, "ProtectedData.Protect(Encoding.UTF8.GetBytes(key), Entropy, DataProtectionScope.CurrentUser)", "ProtectedData.Protect(Encoding.UTF8.GetBytes(key), Entropy, DataProtectionScope.LocalMachine)", "selftest: key: DPAPI (ProtectedData, CurrentUser) round trip, the blob never the key"],
  ["Protect hands back the key itself", K, "return Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(key), Entropy, DataProtectionScope.CurrentUser));", "return key;", "selftest: key: DPAPI (ProtectedData, CurrentUser) round trip, the blob never the key"],
  // the server's engine build against the table's
  ["the server's build not compared", O, "var warn = EngineBuildWarning(login.EngineBuild, wantBuild);", "string warn = null;", "selftest: build: another build than the table's: amber, both named, ask the host"],
  ["the warning when either build is unknown", O, "if (string.IsNullOrEmpty(have) || string.IsNullOrEmpty(want) || have == want) return null;", "if (have == want) return null;", "selftest: build: a server too old to say: green, no warning"],
  ["the room's build not read", P, "r.EngineBuild = found == null ? null : J.Str(found, \"engine_build\");", "r.EngineBuild = null;", "another engine build than the table's: amber, both named, Try again"],
  ["the table's build not passed to the light", C, "Set(StepStack, OwnServer.Decide(s, login, Game, J.Str(deployed, \"engineBuild\")));", "Set(StepStack, OwnServer.Decide(s, login, Game));", "another engine build than the table's: amber, both named, Try again"],
  // no box
  ["the box back on the page", W, "  <details id='tablebox' class='card'>", "  <details id='srvbox' class='card' hidden></details>\n  <details id='tablebox' class='card'>", "page: no Own server box (the owner's decision, 2026-11-17)"],
  ["POST /api/server answered again", U, "                    case \"/api/tools\":\n", "                    case \"/api/server\":\n                    case \"/api/tools\":\n", "selftest: wiring: POST /api/server is gone (no box): not found, server.json kept"],
  ["the friend README without its own-server section", F, "OPTIONAL: PLAY ON A FRIEND'S ENGINE (OWN SERVER)\n", "OPTIONAL\n", "friend README own server: the section"],
  ["the friend README without the light", F, "the third light, \"Your server\", says whether the\n   server answers", "the third light says how it is", "friend README own server: the light"],
  ["the friend README without Tailscale only", F, "That is the only way we\n   recommend", "That is one way we\n   recommend", "friend README own server: Tailscale only"],
  ["the friend README offers TLS again", F, "4. Deleting server.json goes back", "   Or use a secure (wss) address.\n4. Deleting server.json goes back", "friend README own server: no TLS advice"],
  ["the friend README sends you to a box", F, "2. Write server.json in this folder (Notepad is fine):", "2. On the status page press Use this server, or write server.json in this folder:", "friend README own server: no box"],
  ["a package may hold server.json", F, "return base === \"server.json\" || base === \".env\"", "return base === \".env\"", "secretFiles: server.json, a stack .env and key files"],
];

// the C# build of a source folder (null: no compiler here)
const has = (cmd) => spawnSync(WIN ? "where" : "which", [cmd], { stdio: "ignore" }).status === 0;
function buildFrom(companionDir, out) {
  if (WIN) {
    const r = spawnSync("cmd", ["/c", path.join(companionDir, "build.cmd")], { encoding: "utf8", timeout: 300000 });
    if (r.status !== 0) return `build.cmd: ${r.stdout}${r.stderr}`;
    fs.copyFileSync(path.join(companionDir, "bin", "MTG Companion.exe"), out);
    return null;
  }
  const refs = ["System", "System.Core", "System.Drawing", "System.Windows.Forms", "System.Management", "System.Web.Extensions", "System.Security", "System.IO.Compression", "System.IO.Compression.FileSystem"];
  const src = path.join(companionDir, "src");
  const cs = fs.readdirSync(src).filter((f) => f.endsWith(".cs")).map((f) => path.join(src, f));
  const r = spawnSync("mcs", ["-nologo", "-target:winexe", "-langversion:5", `-out:${out}`, `-resource:${path.join(companionDir, "release-keys.txt")},release-keys.txt`, ...refs.map((x) => `-r:${x}.dll`), ...cs], { encoding: "utf8", timeout: 300000 });
  return r.status === 0 ? null : `mcs: ${r.stdout}${r.stderr}`;
}
const runTest = (test, env) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, test)], { encoding: "utf8", timeout: 1200000, maxBuffer: 1 << 26, env: { ...process.env, ...env } });
  const failed = [];
  for (const line of String(r.stdout).split("\n")) if (/^FAIL /.test(line)) failed.push(line.slice(5));
  if (r.status !== 0 && !failed.length) failed.push(`${test} exit ${r.status} ${String(r.stderr).slice(0, 300)}`);
  return failed;
};

if (!WIN && !(has("mcs") && has("mono") && has("xvfb-run"))) { console.log("needs a C# compiler: build.cmd on Windows, or mono's mcs, mono and xvfb-run"); process.exit(1); }
const pattern = process.argv.slice(2).find((a) => !a.startsWith("--"));
const only = pattern ? new RegExp(pattern, "i") : null;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-own-server-"));
const pristine = Object.fromEntries([...new Set(MUTATIONS.map((m) => m[1]))].map((f) => [f, sha(path.join(ROOT, f))]));
const checkPristine = () => {
  for (const [f, h] of Object.entries(pristine)) if (sha(path.join(ROOT, f)) !== h) { console.log(`REAL FILE CHANGED: ${f}`); process.exit(100); }
};
process.on("exit", () => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

// the tests must pass on the real files first: a test that fails by itself proves nothing
for (const [test, env] of [[OWN, {}], [PKG, {}]]) {
  const base = runTest(test, env);
  if (base.length) { console.log(`BASELINE FAILS (${test}): ${base.slice(0, 3).join(" | ")}`); process.exit(1); }
}
let survived = 0, caught = 0, equivalent = 0;
for (const [label, file, from, to, want, mark] of MUTATIONS) {
  if (only && !only.test(label)) continue;
  const real = path.join(ROOT, file), src = fs.readFileSync(real, "utf8");
  const n = src.split(from).length - 1;
  if (n !== 1) { console.log(`NOT APPLIED (${n} matches) ${label}`); survived++; continue; }
  const mutant = src.replace(from, () => to);
  let failed;
  if (file === F) {
    try { fs.writeFileSync(real, mutant); failed = runTest(PKG, {}); }
    finally { fs.writeFileSync(real, src); checkPristine(); }
  } else {
    // a copy of companion/ with the changed file, built
    const dir = path.join(TMP, `c${caught + survived}`);
    fs.cpSync(path.join(ROOT, "companion"), dir, { recursive: true, filter: (p) => !p.includes(`${path.sep}bin`) });
    fs.writeFileSync(path.join(dir, path.relative(path.join(ROOT, "companion"), real)), mutant);
    const exe = path.join(dir, "mutant.exe");
    const why = buildFrom(dir, exe);
    if (why) { console.log(`DOESN'T BUILD ${label}: ${why.slice(0, 300)}`); survived++; continue; }
    failed = runTest(OWN, { COMPANION_EXE: exe, COMPANION_PAGE: path.join(dir, "src", "WebPage.cs") });
    fs.rmSync(dir, { recursive: true, force: true });
    checkPristine();
  }
  const named = failed.some((f) => f.startsWith(want));
  if (named) { caught++; console.log(`caught   ${label}: ${want}${failed.length > 1 ? ` (+${failed.length - 1})` : ""}`); }
  else if (mark && mark.equivalentOn === process.platform && !failed.length) { equivalent++; console.log(`EQUIVALENT ${label} on ${process.platform}: ${mark.why}`); }
  else { survived++; console.log(`SURVIVED ${label}${failed.length ? ` (failed instead: ${failed.slice(0, 2).join(" | ")})` : ""}`); }
}
console.log(`${caught} caught, ${survived} survived${equivalent ? `, ${equivalent} equivalent on this platform` : ""}; the real files unchanged (sha256)`);
process.exit(survived ? 1 : 0);
