# Report: own-server mode in the Windows companion

Cloud session, 2026-11-17, branch `cloud/companion-own-server`, from `origin/main` (f63de76).

- The Windows app (`companion/src`, C#) now has the mode the Linux/Mac companion got on 2026-11-16
  (`docs/handoff/companion-server-report.md`). Both use the same `server.json`.
- **Built and tested here with mono's `mcs` (C# 5, the same sources) and run under mono with a virtual display.** It
  wasn't built with Windows' `csc` or run on Windows. `tests/test_companion_own_server.js` does both there:
  `build.cmd`, then the exe itself.

## What it does

A friend's companion plays on the host's engine (relay and Forge room) over the network, with no Docker on the
friend's PC. The friend still hosts TTS and the bridge.

**The setting**

- **`server.json`** in the package folder (home mode: the repo's root), e.g.
  `{ "host": "mtg.example.org", "port": 9443, "key": "...", "secure": false }`.
  - Only `host` and a key are needed; `secure: true` uses `wss://`.
- **`--server HOST[:PORT]`** sets it for one run.
- **Where the key comes from:** `server.json`, only for the same host (a `--server` naming another host never gets the
  file's key); else `MTG_SERVER_KEY`. It is never the package's own key.
- **The status page's Own server box** (new, `POST /api/server`): Server and Key fields (the key a password field),
  Secure, **Use this server** and **Use this computer**.
  - A blank key keeps the saved one for the same host.
  - Changes are refused during a game, in observe mode and under `--server`.
  - The box is hidden when the status JSON has no `server` part, so the Linux/Mac companion (same page) shows nothing
    new.
- **Refused, with the reason:** a scheme in the host, a bad name, a port outside 1-65535, a misspelt setting, an empty
  key, `secure` not true/false, broken JSON (Notepad's BOM is fine), no key.

**The start light**

- **Docker and Engine images:** green, "Not needed here: the engine runs on your server (host:port)". Nothing is asked
  of Docker.
- **The third row is renamed "Your server".**
  - One relay login to `ws[s]://host:port`, 5 s, then the room list.
  - Green: "Your server answers (...): room tts-commander is open", or in our game.
  - Red, each with **Try again** and a help text:
    - refused the key;
    - refused the connection, nothing listens on the port;
    - the name isn't known (a new `LoginKind.NotFound` from the DNS error);
    - didn't answer;
    - the Forge room isn't open;
    - busy with an earlier game.
  - Not probed during a game. The watcher asks every 60 s.
- **Bridge:**
  - Started with `MTG_RELAY`, `MTG_KEY` and `MTG_REMOTE_ENGINE=1`, which `bridge.js` already reads. Without a server
    the three are emptied, so a stray variable never points it elsewhere.
  - A running bridge whose `/versions` names another relay is amber, **Restart the bridge**.
- **Stop everything** stops only the bridge. The server's engine is never stopped from here.
- **The key** is never logged, shown, or written to the dump. The page gets only its last 2 characters, and only when
  it is 8 characters or longer.

**Files**

- `companion/src/OwnServer.cs` (new): the pure rules.
- `Controller.cs`:
  - `ReadServer`, `SetServer`, `NotHere`, `DoServer`, `MonitorServer`;
  - `BridgeLoopInfo` / `EngineEnv`;
  - the bridge-relay check;
  - Stop everything.
- `Probes.cs`: `NotFound`.
- `Logic.cs`: `Layout.ServerFile`, `LoginKind.NotFound`.
- `Program.cs`: `--server`, and `--selftest --section`.
- `WebUi.cs`: `/api/server` and the status JSON's `server` part.
- `WebPage.cs`: the box, `serverView` and `serverRequest`.
- `SelfTestServer.cs` (new): the self-test section, also appended to the full `--selftest`.

**The friend package**

- `README-FRIEND.txt` has a new section, "OPTIONAL: PLAY ON A FRIEND'S ENGINE (OWN SERVER)". It covers:
  - the address and key from the host;
  - the Own server box, or `server.json`, or `--server`;
  - the lights, and what each red one means;
  - Use this computer;
  - keeping the key private;
  - that the server is never stopped.
- PRIVACY now says what own-server mode connects to.
- **The packager refuses a package holding a file with a key** (`secretFiles`: `server.json`, `.env`, `*.pem`/`.key`/
  `.pfx`/`.p12`, `github-token.bin`). An update never touches a friend's `server.json`: no part holds it.
- **The engine side:** the host's relay must be reachable from the friend's PC. `tools/setup-server.sh` binds it to
  `RELAY_BIND`, for example the Tailscale address (noted in `docs/server-setup-spec.md`).
- **The spec:** `docs/companion-app-spec.md` has a new §5.8, and §14.6 says it is built.

## Tests

- **`--selftest --section own-server`: 60 of 60.**
  - Parsing, precedence and every refusal.
  - Every light.
  - The bridge's environment and the relay check.
  - The page's view and box.
  - Wiring on a real Controller in a temp package:
    - the row name;
    - the start steps ask nothing of Docker;
    - the bridge loop's environment;
    - `POST /api/server` (Use this server, Use this computer, a bad address, no token);
    - observe mode;
    - the key never in the log.
  - The full `--selftest` couldn't be run here: under mono on Linux an existing Windows-path case (`WorkshopTable`)
    throws before the end. That happens on the unchanged code too.
- **`tests/test_companion_own_server.js` (new, in the deploy GATES): 27 of 27, about 10 s.**
  - It builds the exe, runs the self-test section, then the real companion (`--observe --dump --steps 1,2,3`) in a temp
    package against a fake relay on a spare port (never 9443).
  - The cases: green, a wrong key, nothing on the port, a name that doesn't resolve, no key, `MTG_SERVER_KEY`, a broken
    `server.json`, `--server`, a busy room, no Forge room, and no `server.json` (this computer's engine). Also: the key
    sent to the server and never in the dump, log or output.
  - It also checks the page's box out of `WebPage.cs`.
  - With no C# compiler it checks the page only and says SKIP. On Windows it uses `build.cmd`.
- **`tests/test_friend_package.js`: 119 of 119** (13 new): the README's own-server section, no address but 127.0.0.1
  and no key value in it, `secretFiles`, and a built zip holding no key file.
- **Unchanged and passing:**
  - `test_companion_page` 242 of 242;
  - `test_companion_server` 43 of 43;
  - `test_friend_package_unix` 81 of 81;
  - `companion-node --selftest` 480 of 480.

## Break-its

`node tools/mutate-companion-own-server.js`: 26 mutations. **26 caught by name, 0 survived.**

- **How each runs:** a C# or page mutation is built from a copy of `companion/`. A friend-package one edits the script
  in place for one test run and is put back. The real files are checked by sha256 after each.
- **Rules broken:**
  - **Parsing:** the default port; a `ws://` host accepted; a misspelt setting; a cut-off `server.json`;
    `MTG_SERVER_KEY` beating the file's key; `--server`'s other host given the file's key; `secure` ignored.
  - **The light:** a busy room counted as ours; the refused message made generic; DNS failures not told apart.
  - **The bridge:** the key or the server variables not passed, or not emptied for this computer; a too-old bridge
    trusted.
  - **The page:** the whole key shown; the old key reused for another host; Use this computer not removing the file;
    the box's default port, its `ws://` check and its hiding.
  - **Wiring:** Docker asked with a server; the login made locally; the row name.
  - **The friend package:** the README's section, the README's light paragraph, and `secretFiles` letting
    `server.json` through.
- **Fixed after the first run:**
  - The bridge-environment check crashed instead of failing by name; it now reads the values safely.
  - "Docker still asked" was hidden by the watcher's first tick before `--dump` writes. A new self-test check runs the
    start steps alone.
- **Not covered:**
  - Stop everything with a server never calling `compose down`: no Docker in the test.
  - `SetServer` refusing during a game: the self-test's bridge URL points at nothing, so no game is on.
  - The packager's `stop` on a secret file: it needs the engine images to build a package.

## Left

- Build with `build.cmd` and run the full `--selftest` and `test_companion_own_server.js` on Windows.
- A real two-PC try: one PC's engine (`tools/setup-server.sh` or Docker), the friend's companion with its address and
  key, a game to the end.
- A screenshot of the Own server box for the tutorial.
