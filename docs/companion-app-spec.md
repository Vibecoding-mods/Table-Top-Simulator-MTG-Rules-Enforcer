# MTG Companion: what is built (spec rewritten from the code, 2026-11-11)

Status: **built and in use** (Windows only). This replaces the 2026-10-20 and 2026-11-05 versions, which described an
app that did not exist yet. Every statement below was read from the code on branch `main` at 71f6557; `file:line`
points at it. Where something is *planned but not built* it is said so in capitals and collected in §14. The earlier
text (a 12-light design, a build plan, a Tauri and a "scripts only" decision) is in git: `git show 71f6557:docs/companion-app-spec.md`.

Not re-run for this rewrite: the app was not built or started, and `--selftest` and the two Node test files were not
run (docs-only task). Test counts quoted from the earlier spec are marked as such.

## 1. What it is

**MTG Companion.exe** is a small Windows program, written in C# 5 and compiled with the `csc.exe` that ships with
Windows (`companion/build.cmd:1-29`; no SDK, no NuGet, .NET Framework 4.8, `/target:winexe`). Double-click it and it:

1. runs a six-step start sequence, one status light per step: Docker, Engine images, Engine stack, Table save, Bridge,
   TTS (`Controller.cs:48-49`);
2. then keeps watching and keeps the lights current (`Controller.cs:340-344`, `1057-1111`);
3. never restarts or replaces anything while a game is on, or while it cannot tell whether one is (§6);
4. shows everything as a **status page in the default browser** on `127.0.0.1:48790`, plus a tray icon (§8, §9);
5. in the friend package, updates itself from signed GitHub releases (§11).

It is for the **host** only. Friends join the host's TTS game and need nothing of ours.

Source (7,596 lines in `companion/src/*.cs`, counted 2026-11-11):

| File | Lines | Holds |
|---|---|---|
| `Logic.cs` | 712 | pure decisions, no I/O: lights, game lock, save plan, layout detection (`Logic.cs:1-3`) |
| `Controller.cs` | 1190 | the worker thread, start sequence, watcher, fixes and menu actions |
| `Probes.cs` | 581 | the I/O: Docker engine pipe, HTTP, relay login, TCP table, processes |
| `WebUi.cs` | 933 | the status page server and its JSON API, table-tools passthrough |
| `WebPage.cs` | 718 | the page itself (HTML, CSS, ES5 script) as one C# string |
| `StatusForm.cs` | 489 | tray icon and menu, the old window (fallback), dialogs, shutdown block |
| `Update.cs`, `Updater.cs` | 517, 751 | self-update: pure rules, then check, download, apply, undo |
| `Program.cs` | 369 | command line, single instance, the bridge loop process |
| `SelfTest.cs`, `SelfTestWeb.cs` | 782, 554 | `--selftest`: the logic against canned inputs |

Also: `companion/app.manifest` (asInvoker, so it never asks for admin), `companion/app.ico`,
`companion/release-keys.txt` (public update keys, built into the exe, `build.cmd:19-21`).

## 2. Two layouts

`Logic.DetectLayout` (`Logic.cs:122-138`) picks one:

| | **Friend mode** | **Home mode** |
|---|---|---|
| Chosen when | `version.json` sits beside the exe | no `version.json`, but `bridge\bridge.js` and `Start MTG.bat` are in the exe's folder or up to 4 above it (so `companion\bin\` works) |
| Package root (`MTG_HOME`) | the exe's folder | the repo |
| Node | `runtime\node\node.exe` | `node` on PATH |
| Compose project | `mtg-table` | `stack` |
| Logs | `logs\companion.log`, `logs\bridge.log` | `tmp\companion.log`, `tmp\bridge-live.log` |
| Starts the bridge by | `MTG Companion.exe --bridge-loop` (§5.5) | `tools\start-bridge.ps1` |
| Table save step | installs the save into TTS's Saves folder | skipped, grey: "you keep your own save" |
| Self-update | yes (§11) | no: "the repo updates with git" (`Controller.cs:211-215`) |
| Compose up | `up -d` | `up -d --no-recreate` (`Controller.cs:696`) |
| Expected versions from | `version.json` | `stack\deployed.json` (`Controller.cs:169`) |

All paths: `Layout.Make` (`Logic.cs:76-110`). `--home DIR` overrides the folder (`Logic.cs:124-129`).

## 3. Command line

From the header of `Program.cs:3-17`, checked against `Main` (`Program.cs:120-292`):

| Flag | Does |
|---|---|
| (none) | start sequence, then watch; status page and tray |
| `--observe` | reads and shows only; no start, no fix, no update, no single-instance lock (`Program.cs:236`). `--dump FILE` writes the lights after one pass and exits; `--shot FILE` (with `--observe`) writes a PNG of the old window |
| `--no-web`, `--web-port N`, `--no-browser` | status page switches (`WebUi.cs:283-293`) |
| `--home DIR`, `--saves DIR`, `--state DIR`, `--log FILE`, `--bridge-url URL`, `--steps 4,5` | test overrides (`Program.cs:144-250`) |
| `--selftest [--out FILE]` | the decision logic against canned inputs; exit code = failures (`Program.cs:125-131`) |
| `--bridge-loop --home DIR` | internal: the hidden process that runs and restarts the bridge (§5.5) |
| `--bridge-stop` | stops this package's loop and bridge only (`Program.cs:210-218`) |
| `--probe-login URL [KEY]` | one relay login, printed (`Program.cs:137-143`) |
| `--update-check`, `--update-now`, `--update-base`, `--test-*`, `--fake-effects`, `--fake-fail` | headless update and its test hooks (§11, `Program.cs:68-117`) |
| `--set-token` | reads a GitHub token from stdin and stores it with DPAPI (`Program.cs:196-202`) |
| `--replace-old PID PATH --old-start TICKS --part-version V` | internal: the new exe takes over from the old (§11.5) |
| `--write-icon FILE` | writes the app icon |

Single instance: mutex `Local\MtgTtsCompanion`; a second start signals the first to show itself and exits
(`Program.cs:236-242`).

## 4. The lights

Colours (`Light` enum, `Logic.cs:14`): green, amber, red, grey (not checked or stopped), and **busy** (working; shown blue
in the page and as amber with `busy:true` in the JSON, `WebUi.cs:553-563`). `Verdict` = colour + one plain sentence + at
most one fix button + an internal next action + an optional longer hint (`Logic.cs:17-31`). The header shows the
worst light, and a red light is named: "Problem: Bridge" (`WebUi.cs:596-607`).

The six lights and what turns each colour (all pure functions in `Logic.cs`, so `--selftest` can feed them canned facts):

| # | Light | Decided by | Green | Amber | Red (button) |
|---|---|---|---|---|---|
| 1 | Docker | `DecideDocker` `Logic.cs:239` | engine answers (`GET /info` on the Docker pipe), Linux containers | (watcher) Desktop runs but engine silent | Windows containers, not installed (address as text, no download), pipe refuses this account ("sign out and back in"), 180 s without an answer (**Start Docker Desktop**) |
| 2 | Engine images | `DecideImages` `Logic.cs:311` | `mtg-relay:exile` and `mtg-forge-node:exile` exist and match the expected ids | friend: a newer engine waits for the game to end; ids differ after a load (games probably fine); home: present but not the deployed ids | missing (friend: **Load the engine again** or **Try again** when the tar is missing; home: "run build-images.sh") |
| 3 | Engine stack | `DecideStack` `Logic.cs:344` | relay and room containers running, relay healthy, login works, room `tts-commander` in `Lobby` (or in a game while locked) | - | no relay or room container (**Start the engine**), unhealthy, login fails or room busy while no game (**Restart relay and room**), relay refuses the key (**Try again**), 5-minute wait ran out |
| 4 | Table save | `DoSave` `Controller.cs:834`, `PlanSave` `Logic.cs:413` | installed, adopted, or already up to date | a newer table waits for the game to end | `table\MTG Table.json` missing, or the write failed (**Try again**) |
| 5 | Bridge | `DecideBridge` `Logic.cs:487`, `DecidePorts` `Logic.cs:466` | `/versions` answers and `now.bridge` equals the expected hash | runs but is not the package's/deployed bridge, or did not answer in time (**Restart the bridge**) | another program holds 39998 or 48787 (**Show the program**), another MTG bridge holds them, unwritable folder, 45 s without starting (**Start the bridge**) |
| 6 | TTS | `DecideTts` `Logic.cs:521` | TTS runs and the table spoke to the bridge since this TTS started, with the expected stamp | TTS not running (**Open TTS**), table not loaded yet, table stamp `"dev"`, bridge not up yet | table has no version, or a different stamp than expected ("load it again") |

Rules that apply to all of them:

- **Slow is not down.** Only "connection refused" counts as "nothing listens" (`HttpKind.Refused`, `Logic.cs:642`); a
  timeout is "can't tell" (`DecideBridge` returns amber, `Logic.cs:503`; `DecideGame` returns CantTell, `Logic.cs:213`).
- The probes' `HttpWebRequest`s (`Probes.cs:274, 304`) and the relay WebSocket (`Probes.cs:360`) set `Proxy = null`. The updater does
  **not**: `Updater.cs:84` sets it only when a test base URL is given, so real GitHub requests use the system's default proxy.
- A light that turns red raises a tray balloon, at most once per light per 10 minutes, not in observe mode and not while the
  window is visible (`Controller.cs:426-434`, `StatusForm.cs:243`).
- A light change is written to `companion.log`; busy progress text is logged at most every 15 s (`Controller.cs:415-437`).
- Tray tooltip: "MTG: <light> problem", "N to check", "stopped", "game on" or "ready" (`StatusForm.cs:366-371`).

### 4.1 The TTS light, in detail

The light is the only place where the app learns what TTS has loaded, and it does so **without ever talking to TTS**: the
app has no connection to port 39999 (grep of `companion/src` finds no `39999`; the only port numbers used are 9443 for the
relay, 39998/48787 for the bridge's ports, 48787 for the bridge, and its own 48790).

Facts it combines (`Controller.cs:1038-1053`):

- `Running`: a process named `Tabletop Simulator` (`Probes.ProcessRunning`).
- `now.table` from the bridge's `GET /versions` (cache up to 90 s): the stamp the table sent the bridge; absent means the
  table has not spoken (`J.Has(now,"table")`).
- `tableHeardMs` from the same answer (`bridge.js:9300-9301`): how long ago the table last spoke. Compared with how long
  TTS has been running (`Probes.ProcessStartUtc`): a table heard *before* this TTS started is the last session's stamp,
  so the light stays amber, "TTS is running, the table isn't loaded in it yet" (`Logic.cs:532-536`). This was added after a
  live check on 2026-11-11 where a relaunched TTS on its main menu was shown as "Connected" (`Logic.cs:532-534`).
- The expected stamp: `version.json` `table` (friend) or `stack\deployed.json` `table` (home).

Start behaviour: `DoTts` opens TTS through `steam://rungameid/286160` only if it is not running, Steam is in the registry,
and the app has not already launched it this run; it waits up to 120 s for the process and **always lets the sequence
finish** (`Controller.cs:1025-1036`). The hint, in an amber light, says how to load the table:
"In TTS: Create → Singleplayer (or Multiplayer) → Games → Save & Load → <save name>" (`Logic.cs:516-519`).
No TTS crash, hang, object-count or GPU watching exists (§14).

## 5. The start sequence

`RunSequence(from)` runs steps `from..6` (`Controller.cs:468-499`). Each step is a method that sets its light and returns
true to go on. A false stops the sequence there, greys the steps after it with "Waiting for <step>", and records
`stoppedAt`. Phase text: "Starting: step N of 6", "Ready", "Stopped at step N (...)".

### 5.1 Docker (`DoDocker`, `Controller.cs:540`)
Reads `GET /info` over the named pipe `dockerDesktopLinuxEngine`, then `docker_engine`, as plain HTTP/1.0, no child
process, 10 s (`Probes.cs:86-130`, `Controller.cs:505`). The Docker CLI is only a fallback when the pipe does not answer, at
most every 30 s (`Controller.cs:514-526`). `UnauthorizedAccessException` on the pipe sets `PipeDenied`: "not in docker-users
yet" (`Probes.cs:107`, `Logic.cs:253-255`). If Docker is down, it starts `Docker Desktop.exe` (found via the uninstall key or the
default path) and polls every 3 s for 180 s (`Controller.cs:553-555`, `Logic.cs:261`).

### 5.2 Engine images (`DoImages`, `Controller.cs:581`)
Image ids by `GET /images/<tag>/json` on the pipe (`Probes.ImageId`). Friend mode compares with `version.json`
`relay`/`node`, or with the ids Docker reported after an earlier load of this same package, remembered in
`%LOCALAPPDATA%\MTG Companion\state.json` `images` (Docker's containerd store reports other ids than `docker save`'s,
`Controller.cs:784-821`). Missing or different: `docker load -i images\mtg-images.tar` with a percentage read from the
docker process's I/O counters, 90-minute limit (`Controller.cs:638-652`), then, if this Docker's ids differ, they are written into
the package's `stack\deployed.json` as `node`/`relay` with the package's own kept as `nodePackage`/`relayPackage`
(`Logic.DeployedAfterLoad` `Logic.cs:287-302`, `RewriteDeployed` `Controller.cs:796-810`) so the bridge's `/versions` agrees.
While a game runs this step is amber and loads afterwards (`Logic.cs:337-338`). Home mode never loads.

### 5.3 Engine stack (`DoStack`, `Controller.cs:687`)
1. Not while locked: `docker compose -p <project> -f stack\compose.yml up -d` (friend; `--no-recreate` in home), 180 s.
2. Friend mode always, home mode only after **Restart engine** or a stack fix (`forceFresh`): `restart relay forge-room`,
   so the room is fresh (as `Start MTG.bat` does) (`Controller.cs:703-708`).
3. Waits up to `Logic.StackWaitSeconds` = 300 s (`Logic.cs:160`; a cold room took 2 min 15 s on 2026-11-10) polling every 2 s: containers
   by compose labels (`Probes.Container`), then a **WebSocket login** to `ws://127.0.0.1:9443` as `companion-xxxx` with
   `Authenticate`, then `ListRooms`, expecting `tts-commander` in `Lobby`, always closed properly (`Probes.cs:353-405`). The key
   is `MANABREW_SERVER_KEY` from `stack\.env` or `tts-local` (`Logic.RelayKey` `Logic.cs:598`).
4. Login failing 3 times on a healthy relay (the stale 9443 forward after `wsl --shutdown`), or a room busy 5 times, restarts relay
   and room once by itself (at most twice), unless a game is on (`Controller.cs:727-739`). The watcher does the same between runs:
   two fresh logins in a row (60 s apart) refused by a healthy relay, no game, restart relay and room once, at most every 10 minutes
   (`Logic.HealRelayNow`, `Controller.HealRelay`; only the engine, never the later steps, so it never reopens TTS). While Docker
   doesn't answer, the Engine images and Engine stack lights are grey "Waiting for Docker." and both are read again as soon as it does.
5. "port is already allocated" is turned into a sentence naming the other engine (`Logic.ComposeFailure` `Logic.cs:391`).

### 5.4 Table save (`DoSave`, `Controller.cs:834`; friend only)
`Logic.PlanSave` (`Logic.cs:413-443`) never writes over a file the app did not install:
- the file in `state.json` (`saveFile`, `saveHash`): update it **only** if the package's save hash changed **and** the file still
  hashes to what the app installed; if the player has saved over it, the new table goes to a new number beside it;
- a byte-identical save is adopted (no write);
- otherwise `TS_Save_N.json`, N one past every number in use (`.json` or `.png`), written with a move that refuses an existing file
  (`Controller.cs:866-873`).
The Saves folder is `Documents\My Games\Tabletop Simulator\Saves` (`Program.cs:231`). An update keeps the last 5 backups in
`%LOCALAPPDATA%\MTG Companion\backup` (`Controller.cs:874-882`). During a game an update to the save waits (amber).

### 5.5 Bridge (`DoBridge`, `Controller.cs:922`)
Reads `GET <bridge>/versions` (15 s). If nothing answers and no `bridge.js` node process exists and no other program holds the
ports, it starts the bridge and waits up to 45 s (`Controller.cs:938-958`). Before it starts, friend mode test-writes the
`logs` and `bridge` folders: unwritable gives one red "move the folder, e.g. C:\Games\MTG-Table" instead of a crash loop
(`Logic.WriteProblem` `Logic.cs:379`).

How it starts it (`Controller.cs:979-994`): friend mode launches `MTG Companion.exe --bridge-loop --home <folder>` hidden. That
process, a separate one so closing or updating the app never touches a game, runs
`cmd /c node.exe --report-on-fatalerror ... bridge\bridge.js >> logs\bridge.log` with `MTG_HOME` and `MTG_LOG_DIR=logs`, and
**restarts it 3 s after any exit** (`Program.cs:298-368`; one loop at a time via mutex `Local\MtgTtsCompanionBridgeLoop`;
`bridge.log` rotated to `.1` at 20 MB). Home mode runs `tools\start-bridge.ps1`. The bridge itself rejoins a running game if
it is back in time (bridge `resumeGame`, `bridge.js:9333`).

Ports: `Probes.Listeners` reads the TCP table (`GetExtendedTcpTable`, `Probes.cs:446-483`) for 39998 and 48787 and the owner's
command line (WMI). `DecidePorts` (`Logic.cs:466`) says red for a foreign owner (e.g. the VS Code TTS extension), and for a
node running another `bridge.js` ("Another MTG bridge is already running"); a node whose command line cannot be read is
"can't tell" and left to `/versions`. A command line counts as a bridge only for a file named exactly `bridge.js`
(`Logic.cs:457-460`).

### 5.6 TTS (`DoTts`, §4.1)

### 5.7 After a stop, and button order
- `stoppedAt` remembers the first step a run did not finish. **Carry on by itself**: when the watcher sees that step's light turn
  green, the sequence resumes from the next step, except the table-save step (the watcher never re-reads it) and not in observe
  mode (`Logic.ResumeAfterStop` `Logic.cs:184-187`, `Controller.cs:402-408`).
- **Never skip a step**: a button for a later step starts at the earlier of "its step" and "the first step not done"
  (`Logic.StartFrom` `Logic.cs:173-177`). Origin: on the 2026-11-10 fresh install the engine timed out at step 3, Start the
  bridge ran 5-6, and the table save (4) was never installed.

## 6. The game lock

`Logic.DecideGame` (`Logic.cs:191-215`) turns the bridge's `GET /state` (5 s) and the age of the bridge's resume file into one of
three answers, **Game on**, **No game**, **Can't tell**:

| Bridge says | Result |
|---|---|
| `/state` 200 but the body cannot be read | Game on if the resume file is fresh, otherwise Can't tell (`Logic.cs:196-199`) |
| `/state` 200 with `started: true` | Game on, "turn N, M players (K AI)" |
| `/state` 200 with `seats` not null, not started | Game on ("set up or just finished: restarts unlock after `mtg reset`") |
| `/state` 200, no seats | No game (unless the resume file is under 60 s old: "bringing a game back") |
| connection refused | No game; but Game on if `bridge-game.json` is under 60 s old (the bridge just crashed mid-game) |
| timeout or error | Can't tell, or Game on if the file is fresh |
| timeout, error or not 200, and port 48787 is held by a program known not to be a bridge | as connection refused (`Logic.StateForLock`): another program on the port means no bridge runs |

The resume files are `logs\bridge-game.json` and `tmp\bridge-game.json` (friend), `tmp\bridge-game.json` (home)
(`Logic.cs:97, 106`). Can't tell locks exactly like Game on (`Logic.Locked` `Logic.cs:228`).

Locked: `images-load`, `stack-restart`, `bridge-restart` (`Fixes.LocksDuringGame`, `Logic.cs:45-48`), the **Restart engine**
menu item, an update's install, the save update, the image load. Never locked: Start Docker Desktop, Open TTS, Start the
bridge (it only runs when nothing runs), Try again, Show the program, the logs folder, Limit Docker's CPU use. **Stop everything**
is allowed during a game only after a second confirmation (`confirmLocked`, `WebUi.cs:783-790`).

"Players" in the banner come from `/state` `players` and `ai` (`Logic.PlayersText` `Logic.cs:220`; the bridge's side is
`bridge.js:9311`), because `seats` lists only people.

## 7. The watcher

After the first pass the worker loops: a queued press, else a queued sequence run, else one watcher tick, then waits 5 s (15 s
when nobody is looking) (`Controller.cs:340-373`). One thread, so two actions never overlap. A tick (`MonitorTick`,
`Controller.cs:1057-1111`):

| Reads | How often | Notes |
|---|---|---|
| bridge `/state` (game lock) | every tick | |
| Docker `/info` | every tick | not answering: amber if Desktop runs, red otherwise, with **Start Docker Desktop** |
| image ids | every 5 minutes | |
| containers | every tick | |
| relay login + room | every 60 s | skipped while locked |
| bridge `/versions` | every 30 s (retry after 5 s on failure) | each call runs `docker inspect` inside the bridge, 3-4 s |
| TTS light | every tick | from the cached `/versions` |
| update install | every tick | a downloaded update installs 2 minutes after the game ends |

"Nobody is looking": the page sends polls; if none came for 20 s (`IdleSec`, `WebUi.cs:227, 446-450`) the watcher slows to 15 s;
the next poll restores it and nudges an immediate tick (`WebUi.cs:452-456`).

### 7.1 Log trim (every 14 days, between games)

The last step of each watcher tick (`Controller.MaybeTrimLogs`) rolls the logs the bridge and the app write. The stamp file
`log-trim.stamp` in the logs folder (`logs\` friend, `tmp\` home) holds the last trim's UTC time; it is read once an hour, and a
trim is due when it is 14 days old, or more than a day in the future (`Logic.TrimDue`); a missing or unreadable stamp reads as the
newest `.old` roll's time (`Logic.LastTrimOr`), so deleting it doesn't trim again at once and drop the last `.old` copies; due
when there is neither. A due trim runs on the first
tick with **no game** (`Logic.TrimNow`: Game on and Can't tell both wait; an `--observe` copy never trims). The decisions are
`Logic.TrimKindOf` / `TrimPlan` / `ArchivePath` / `TrimSummary`; the file work is `LogTrim` (`Controller.cs`).

| File | What the trim does |
|---|---|
| `table-log.log` (the real game history) | renamed to `.trimming`, gzipped to **`log-archive\table-log-YYYY-MM-DD.log.gz`** beside it (`-2`, `-3` for a second one that day), kept forever; the live file starts empty. A `.trimming` a failed run left is archived first at the next trim. |
| `tts-stream*.jsonl` (`MTG_RECORD` recordings) | deleted |
| `tts-console.log`, `game-log.txt`, `table-check.log`, `guess-log.log`, `companion.log` | renamed to `<name>.old`, replacing the earlier `.old` (so about 4 weeks stays readable) |
| `bridge.log` / `tmp\bridge-live.log` and its `.1` | never: the bridge loop rolls it at 20 MB (`Program.cs`), and cmd holds it open |

Folders: the logs folder, and in home mode `bridge\` too (a bridge started without `MTG_LOG_DIR` writes `tts-console.log` and
`game-log.txt` there). Empty files are skipped. Renaming is safe while the bridge runs: it writes these with `fs.appendFile`
(open, write, close per line). A locked or vanished file is skipped, never thrown; the stamp is written anyway (a skipped file
waits for the next trim). One companion-log line says what happened, e.g. `log trim: freed 275.1 MB; table-log.log archived
(14.0 MB to 1.3 MB .gz), tts-stream.jsonl deleted (180.3 MB), ..., guess-log.log skipped (<reason>).`

## 8. The status page (`WebUi.cs`, `WebPage.cs`)

A `TcpListener` on `127.0.0.1:48790` (any free port if taken) with a hand-written HTTP/1.1 parser, because `HttpListener` can
need a URL ACL or admin rights (`WebUi.cs:1-5, 348-371`). `ExclusiveAddressUse` is set. One request per connection.

### 8.1 Endpoints

| Route | Does | Source |
|---|---|---|
| `GET /` | the page; the run's token and a CSP nonce are put in | `WebUi.cs:513-515, 541-549` |
| `GET /api/status` | the whole status (below) | `WebUi.cs:516-519, 655-695` |
| `POST /api/action {id, confirmLocked?}` | the same Controller calls as the old window; answers `{ok, message, needConfirm}` | `WebUi.cs:520-527, 756-846` |
| `GET /api/tools` | the bridge's `GET /tools`, passed through (§10) | `WebUi.cs:528, 859-867` |
| `POST /api/tools {kind, ...}` | one change, passed to the bridge's `POST /tools` | `WebUi.cs:868-880` |

`/api/status` (`"api": 1`): `app, at, mode, home, observe, phase`, `worst {state,busy,text}`, `game {kind, text, turn, locked,
lockText}`, `lights[]` (six: `step, name, state, busy, word, text, hint, at, action`), `menu[]`, `hint`, `versions {text, companion,
table, bridge, save}`, `log {file, lines}` (last 60 lines of `companion.log`), `update` (friend mode only, else null)
(`WebUi.cs:12-27`).

Action ids (`WebUi.cs:770-821`): `fix:<row>:<fix>`, `restart-engine`, `stop-everything`, `open-logs`, `wsl-limits`, `update-check`,
`update-now`, `update-later`. A fix id must match the button the row currently shows, or it is refused ("That button has
changed"). Pressing the action last accepted again while it is still queued or running is "Already running"
(`WebUi.cs:767-768`). **Show the program** runs `taskmgr.exe /0 /startup` and re-queues the Bridge step (`WebUi.cs:835-841`).
**Limit Docker's CPU use** writes `processors=2`, `memory=8GB` into `[wsl2]` of `%USERPROFILE%\.wslconfig` after copying it to
`.wslconfig.bak-<stamp>`; it never restarts WSL (`WebUi.cs:890-901`, `Logic.SetWslLimits` `Logic.cs:547`).

### 8.2 Guards
Host must be `127.0.0.1:<port>` or `localhost:<port>` (DNS rebinding); an Origin, when sent, must be that origin;
`/api/*` needs `X-MTG-Token` (16 random bytes per run, compared in constant time, written only into the served page) and
refuses `Sec-Fetch-Site` other than same-origin/none; POST needs `application/json` (optional `charset=utf-8`)
(`WebUi.cs:460-509`). Parser limits: head 8 KB, body 16 KB, 50 headers, no chunked bodies, bare LF, folded headers or duplicate
Host/token headers refused; a request must arrive within 10 s; at most 16 connections, past that the oldest one still waiting for
its request is closed (`WebUi.cs:74-76, 226-228, 380-407`). Answers carry `no-store`, `nosniff`, frame deny, no referrer and a
nonce CSP with `default-src 'none'` (`WebUi.cs:195-210, 541-549`).

### 8.3 The page
Dark theme, no CDN or fonts, inline script and style. Layout (`WebPage.cs:126-191`): header with the worst light in words;
banners (companion not running, busy, page error, **Game in progress**, observe, update); **Start steps** (the six rows: dot, name,
word, sentence, time, the row's one button); a hint line; **Actions** (the menu: Restart engine, Stop everything, Open logs folder,
Limit Docker's CPU use…); **Table tools: AI seats, debug tools and GIF frames** (collapsed, §10; the GIPHY key box and its "Get a GIPHY key" steps: docs/gif-frames-spec.md); a collapsible **Log** tail; a footer with
versions. Polls `/api/status` every 2.5 s (30 s in a hidden tab), aborts a poll after 6 s; two misses in a row show "Companion
busy, retrying", misses past 10 s show "Companion not running"; a stale token reloads the page at most once per 15 s
(`WebPage.cs:201-204`). Buttons are disabled while their request is in flight. A script error shows a red banner and polling
continues. The script is ES5 pure functions plus a shell, tested in Node with a stub DOM (`tests/test_companion_page.js`).

### 8.4 When the page opens by itself
First start of a package ever (`state.json` `statusPageShown` unset, friend, not observe): once, then the flag is written.
If no browser opens, the old window shows and the flag is **not** written so the next start tries again. Later starts and home
mode: only when the first pass ends with a red light (`WebUi.cs:303-331`). The tray's "Open status" and a click on the icon or
on a balloon open it (`StatusForm.cs:217, 241-242`).

## 9. Tray, window, quit

- **Tray icon** (drawn at run time, colour = worst light; tooltip as in §4). Menu: Open status, Open logs folder, the version
  line, **Check for updates**, **GitHub token…**, Restart engine, Stop everything, Quit (`StatusForm.cs:217-231`).
- **Restart engine**: confirm, then stop bridge → `forceFresh` → run steps 1-6 (`Controller.cs:1134-1149`). Locked during a game.
- **Stop everything**: stops the bridge loop and the bridge, then, only if the Docker light is green, `docker compose ... down` (friend) or `stop` (home) (`Controller.cs:1161`); Docker
  Desktop and TTS keep running; the other lights go grey ("Stopped.") except TTS's, which keeps saying whether TTS runs (green
  "Tabletop Simulator is running (Stop everything leaves it open).", grey "isn't running", followed while stopped,
  `KeepTtsRowStopped`); the header (page badge, tray icon) says **Stopped** in grey whatever stays green, a red row aside
  (`Logic.Overall`, 2026-11-13: it said "Ready" in green); the watcher pauses until Restart engine (`Controller.cs:1152-1168`).
- **Quit** asks: Yes = quit and leave engine and bridge running; No = stop everything, then quit; Cancel. While an update installs,
  Quit says to wait (`StatusForm.cs:458-465`).
- **Old window** (`StatusForm`, 760 × 520): the same six rows with the same buttons. Fallback only: `--no-web`, `--shot`, no free
  port, or no browser opens (`WebUi.cs:271-279`). Closing it hides it to the tray (`StatusForm.cs:299-311`).
- While an update moves files the app blocks Windows shutdown ("Finishing update…") (`StatusForm.cs:145-147, 284-289`).

## 10. Table tools: AI seats and debug tools

The companion only passes these through; **the bridge owns the state** and refuses what is not allowed. The page asks only while
its section is open (once on open, after every POST, and with each status poll) (`WebPage.cs:575, 643-672`).

### 10.1 Companion side (`WebUi.Tools`, `WebUi.cs:854-888`)
- `GET /api/tools` = the bridge's `GET /tools` body. Bridge down or slow, a 404 (a bridge older than the feature) or a non-object
  answer: 502 `no-bridge` with a sentence (`WebUi.cs:864-866, 882-888`).
- `POST /api/tools`: `kind` must be `ai-seat`, `debug-mode`, `debug` or `hand`, else 400 and the bridge is not asked. The body is parsed
  and written again (never the raw bytes) and the answer cut down to `{ok, message}`. Observe mode refuses every POST. The bridge
  answers a refusal as HTTP 200 with `ok:false` so its reason reaches the page (`WebUi.cs:868-880`; bridge `bridge.js:9277-9283`).
- The page limits a pasted deck list so the whole POST is at most 16 KB (the companion's body limit), measured in UTF-8 with
  JSON escapes (`WebPage.cs:335-345, 376`).
- "Host only" means the page itself: it opens only on the host's PC, with that run's token.

### 10.2 AI seats (bridge `bridge.js:407-487`)
Per empty table colour, kept from game to game (until the bridge restarts): `kind` `forge` (Forge AI), `harmless` (a seat the
bridge plays itself, `HarmlessSeat` `bridge.js:853`: keeps its hand, passes every priority, never attacks or blocks) or `off`.
A colour set here is an AI in every game while nobody sits there, and its deck beats `mtg aideck` and any deck lying in that
seat. Deck:
- **preset**: one of `listCommanderPresets()`: our decks in `decks/` then Manabrew's in `manabrew/public/preset_decks`, ours winning
  a clash (`listCommanderPresets`, `bridge/bridge.js:401`, built on `presetIds` and the two folders in `bridge/presets.js`);
- **list**: a pasted deck list, parsed by `parseDeckList` (`bridge.js:420`): `1 Sol Ring`, `1x Sol Ring`, `Sol Ring (CMM) 410 *F*`,
  commander under a `Commander` line or marked `*CMDR*`, `Sideboard`/`Maybeboard`/`Companion` parts skipped, `//` and `#` comments.
  Validated: a commander, every card known to the engine, at least one non-commander card; the deck size is **not** checked
  (`bridge.js:442-461`);
- a harmless bot with no deck plays `ai_passive_lands` (`bridge.js:415`).
A Forge AI needs a deck (`bridge.js:484`, page check `WebPage.cs:378`). The same is available in chat: `mtg ai ...`
(`bridge.js:479-487`). The page shows each seat: `person`, `inGame`, and `ai {kind, kindLabel, deckName, source}`
(`toolsState`, `bridge.js:9014-9028`).

### 10.3 Debug tools (bridge `bridge.js:8936-9011`)
A switch the bridge owns: **off at every bridge start**, and every change is said to the whole table in chat (`setDebugTools`).
While on, each tool is one **manual fix**: the game pauses, the other players vote, then `applyState` runs
(`bridge.js:8940-8941, 8995`). Tools (`DEBUG_TOOLS` `bridge.js:8944`): `mana` (1-99 of W/U/B/R/G/C until end of turn), `hand`
(a card into hand), `battlefield` (a card or token script onto the battlefield), `life` (0-999), `untap` (everything the player
controls). Refused when: tools off, no running table game, game over, the colour not playing, a fix already in progress, a bad
number or card name (`runDebugTool` `bridge.js:9151`). **Draw and mill** (built 2026-11-12, `draw`|`mill`, Number 1-99) are the
engine's own draw and mill: the fix's `draw` and `mill` ops, run by the harness's `applyState` with triggers on, so they need an
engine image (node and relay) built with those ops. A draw or mill op in a fix the table sends is refused; a mill from an empty
library is refused, a draw from one is allowed (it is how decking is tested). A button shows only when the bridge's `tools` lists it.

**Starting hand** (built 2026-11-13, branch `pick-hand`; bridge `bridge.js:11106-11262`, page `WebPage.cs` `#tt-hand`). Up to 7 card
names for one seat's **next** game, while debug tools are on, for a game against the AI. Page: the box under the debug tools
(a seat, 7 card boxes suggesting the names in that seat's next deck, any name the engine knows allowed; Set for next game,
Clear; a line saying the deck and what is waiting). Chat: `mtg hand <card>, <card> ...` (a comma inside a card's own name, as in
"Neheb, the Worthy", is kept; a semicolon always splits), `mtg hand off`, `mtg hand` (what is waiting). `POST /tools`
`{kind:"hand", color, names}` or `{kind:"hand", color, clear:true}`; `GET /tools` adds `hand {max, seats[{color, deck, source,
cards, waiting, added}]}` (`source`: `table` = checked with mtg ready, `preset` = mtg deck, `default` = the engine's default).
- Refused (said): debug tools off; more than 7 names or none; a name the engine doesn't know; not a seat colour; another person
  in the game being set up or played now (a game that is over counts for nothing); a debug scenario waiting for that colour (it sets the hand itself). At the game's
  start the hand is taken only by a table game with that one person and debug tools on, else dropped and said ("Red is playing
  too, and a picked hand is for games against the AI only"). A hand for a colour not in the next game is dropped at its start (said). Switching debug tools off drops every waiting hand
  (said). The pick is not in the resume file: a bridge restart that resumes the game before the first priority loses it.
- A name the deck hasn't got (the commander included, which is never in the library) is **added**, and said before the game
  ("Not in <deck>, so added to the game: ..."), at Set and again at the start: the user named it, so the test asked for runs;
  dropping it silently would test something else. A named card the deck has but doesn't deal is added too, as an extra copy;
  the messages and the page's box say so.
- **When:** the dealt hand is kept by itself at Forge's keep-or-mulligan question (the player is not asked), and at the player's
  first priority with nothing on the stack (in turn 1, whoever's turn; the upkeep in the live check) one debug fix (applies at once against the AI) makes
  the hand the picked one: a picked card that was dealt stays (the deck's own card); each other picked card is created in the
  hand (`createCard`), and for each a dealt card goes to the bottom of the library (the last dealt first). Fewer than 7 named:
  the dealt cards left are the rest. The hand ends as the dealt cards kept, in their order, then the added ones in the order named.
  So it is **not** the opening hand: it is not seen at the mulligan question, an opening-hand action (a Leyline, Chancellor,
  Gemstone Caverns) never sees it, and a deck card that was not dealt is a second copy for that game (its own copy stays in the
  hidden library). With fewer than 7 cards in hand by then (an opening-hand card already used), every dealt card not picked can go under.
- **Why not stacked before the deal** (read 2026-11-13 in `manabrew/forge-harness` and `forge/forge-game`): Forge shuffles in
  `Match.prepareAllZones` (`player.shuffle`) and deals in `GameAction.startGame` with nothing from the bridge in between;
  `awaitMulliganDecision` (ManaBrewInteractiveSession) takes only `mulligan_decision` and `pass`, and throws on any other kind,
  `apply_state` included (the harness takes `apply_state` only while a priority prompt is open, else it answers "not waiting for
  priority"); the library is hidden from the bridge (the board's library zone has a count and no cards) and Forge's card ids are
  given in `CardPool` iteration order (a ConcurrentHashMap), so the deck's own copies can't be moved by id; the first-player roll
  is the harness's own and takes only an acknowledgement. Free mulligans until the cards come were rejected: about 14 deals for
  one named card, hundreds for two.
- **Engine change for a true opening hand** (not built; no image builds on this branch). Smallest honest version:
  1. Deck JSON (`SetDeckSelection`'s `deck`, as `planes` rides today): `openingCards: [names]`, at most 7, in order. The relay
     must carry the field (its deck struct, as for `planes` in the planechase build) and the node must pass it to the harness.
  2. Harness: after `Match.prepareAllZones` has shuffled and before `GameAction.startGame` deals (the first
     `GameEventGameStarted`, fired inside `startGame` before `runPreOpeningHandActions` and the draw; or a hook the harness
     runs from `session.start` before `match.startGame`), for each name in reverse order take one copy of that name from the
     player's library and put it on top (`PlayerZone.remove` then `add(card, 0)`). Forge then deals those cards as the opening
     hand, the rest from the shuffled library; the keep-or-mulligan question shows them; a mulligan reshuffles as usual (the
     cards are not kept through it). The deck is unchanged: every card is the deck's own.
  3. A name with no copy left in the library: the harness skips it and reports it (a game-log line or a field on the first
     state), and the bridge says which. The bridge keeps refusing names the engine doesn't know, and warns before the game which
     named cards the deck lacks (it knows the deck): those would come at the first priority as now, or be dropped (the choice is
     the bridge's; added is today's default).
  4. `StaticData.getFilteredHandsEnabled()` must stay off in the harness (`drawStartingHand` may reshuffle and undo the stack).
  5. Bridge: send `openingCards` in `SetDeckSelection` when the engine says it supports it (a version or capability flag), stop
     auto-keeping, and use the first-priority fix only for the cards the deck lacks. Tests: the bridge goldens here, plus a live
     check on the new image (`tests/live_hand_check.js` already records the real mulligan prompt and the hidden library).

## 11. Install and release flow (friend package)

### 11.1 What the friend does (README.md:82-96; `README-FRIEND.txt` generated at `tools/make-friend-package.js:296-345`)
Install Docker Desktop, start it once, sign out and in (the install adds the account to `docker-users`); download the zip from the
repository's Releases page (**the repository is private and invite-only**, README.md:89); right-click the zip → Properties →
Unblock; unzip to a plain folder (not OneDrive, Documents or Program Files); double-click `MTG Companion.exe` (**not code-signed**:
SmartScreen "More info → Run anyway"; Smart App Control may block it outright). First start loads the engine (a few minutes) and
copies the table into the TTS saves. Then in TTS: Create → Multiplayer → Games → Save & Load → "MTG Table (rules engine)".

### 11.2 Package contents (`tools/make-friend-package.js:20-34`)
`MTG Companion.exe`, `version.json` (`bridge, table, save, node, relay, built, gitCommit, nodeVersion, ...`), `runtime\node\node.exe`,
`bridge\`, `decks\`, `manabrew\public\preset_decks\`, `scenarios\`, `stack\compose.yml` (project `mtg-table`),
`stack\deployed.json`, `images\mtg-images.tar` (docker save of both images), `table\MTG Table.json` + `.png`, an empty `logs\`,
`README-FRIEND.txt`, `LICENSES\`. The packager refuses when `deployed.json` disagrees with the images it would ship, the running
containers or the save (`make-friend-package.js:11, 172`). `--no-images`, `--allow-undeployed-bridge`, `--allow-changed-save`
exist for quick local runs, and are refused with `--release`.

### 11.3 A release (`node tools/make-friend-package.js --release [--tag T] [--previous update-manifest.json]`)
Writes `dist/release-<tag>/` (tag `v<yyyy.mm.dd-HHMM>`) and prints the files to attach; **the user creates the GitHub release
and uploads by hand**, nothing here pushes or publishes. Parts (`make-friend-package.js:186-191`):

| Part | Asset | Holds | "Changed" means |
|---|---|---|---|
| `app` | `app.zip` | bridge, decks, preset decks, scenarios, compose, deployed, README, LICENSES, version.json | sha8 over files, minus `version.json`, `stack\deployed.json`, `README-FRIEND.txt` and the picture cache |
| `table` | `table.zip` | the save | the save's sha8 |
| `images` | `images.tar` | both images | sha8 of the two ids |
| `runtime` | `runtime.zip` | `node.exe` | the Node version |
| `companion` | `MTG.Companion.exe` | the app | sha8 of `companion/src/*.cs`, manifest, `build.cmd`, `release-keys.txt` |

plus `update-manifest.json`, `update-manifest.json.sig` and the full zip (for new friends; the updater never downloads it). A part
whose version equals the previous release's is not rebuilt: its manifest entry points at the release that carries it. Manifest:
`{format, version, built, gitCommit, minCompanion, parts{file,sha256,size,version,release}, full, versionJson, deployedJson}`
(`make-friend-package.js:262-270`).

**Signing**: ECDSA P-256 over the manifest's exact bytes (64-byte r||s, base64). The private key is
`%USERPROFILE%\.mtg-release\release-key.pem` (`MTG_RELEASE_KEY` overrides; refused inside the repo; made on first use) and must be
backed up by the user. The public half is a line of `companion/release-keys.txt`, built into the exe, checked with `ECDsaCng`
against every line (`Update.cs:160-200`, `make-friend-package.js:241-260, 619-630`). Key change: ship one release signed with the
old key whose companion carries both lines (`release-keys.txt` header).

### 11.4 Checking and downloading (`Update.cs`, `Updater.cs`)
- At start (friend, not observe) at most every 6 h (`Updates.CheckEvery` `Update.cs:133`), and from the tray: `GET
  https://api.github.com/repos/Vibecoding-mods/Table-Top-Simulator-Mock-MTGA/releases/latest` with `User-Agent: MTG-Companion`
  (`Update.cs:127-129`). 404 (private repo or no release) → the quiet line "Updates will work once the project is public"
  (`Update.cs:132`); never a red light.
- The signature is checked over the manifest bytes **before** the manifest is parsed; a missing or foreign signature, or a manifest
  whose `version` is not the release's tag, is not used, with the sentence "The update manifest of <tag> isn't signed by this project's release key: not used." in the update line (`Updater.cs:165`). No downgrades: a manifest whose `built` is older
  than the package's is refused (`Update.cs:282`).
- Optional GitHub token (needed while the repository is private): tray **GitHub token…** or `--set-token`; stored with DPAPI
  (CurrentUser) in `%LOCALAPPDATA%\MTG Companion\github-token.bin`; sent only to `api.github.com`, never to a redirect target or
  a test server, never logged (`Update.cs:496-517`, `Update.cs:317`).
- Download only the changed parts to `<package>\updates\<tag>\`. Every URL and redirect (followed by hand, 5 at most) must be
  `https` on `api.github.com`, `github.com`, `objects.githubusercontent.com` or `release-assets.githubusercontent.com`
  (`Update.cs:297`). Partial files resume with `Range`, a 206 counts only if `Content-Range` is right (`Update.cs:322`); size and
  sha256 are checked, mismatch deletes the file (`Updater.cs:214-330`).

### 11.5 Applying (`Updater.Apply` `Updater.cs:331`, `Recover` `585`, `ReplaceOld` `670`)
Never during a game: the update waits, is remembered in `updates.json` `pending`, and installs 2 minutes after the lock clears
(`Updates.IdleBeforeInstall` `Update.cs:134`, `InstallNow` `Update.cs:363`). Under mutex `Local\MtgTtsCompanionUpdate`:
1. write `update-journal.json` before the first move and after every move; stop the bridge loop and bridge;
2. **move** (not copy) what the update replaces into `backup\<old version>\` (last 2 kept, engine images only in the newest,
   `Updater.cs:628-629`);
3. extract zips into the package, each entry under the part's own folders (no `..`, no trailing dot/space segments, no colon);
   write `version.json` and `stack\deployed.json` from the manifest;
4. new images: `docker load` + `compose up -d`; new table: the same hash-guarded save install; start the bridge and wait for
   `/versions`;
5. any failure: undo from the journal (only paths that were moved or created are touched), say "The update failed and was undone";
6. a new companion last: `MTG Companion.new.exe` starts with `--replace-old`, the old app exits, the new one renames itself into
   place (`MTG Companion.old.exe` is deleted at the next clean start).
An install killed half way is finished or undone by `Updater.Recover` at the next start, before the package is read
(`Program.cs:147-160`). State and UI: one `UpdateState` snapshot (`Controller.cs:143-149`) with status idle, checking, up-to-date,
not-public, available, downloading, ready, installing, restarting, updated, failed, interrupted; the page's update banner has
**Update now**, **Later**, **Check for updates** (`WebUi.cs:724-744`).

## 12. Files the app reads and writes

| File | Where | Holds |
|---|---|---|
| `state.json` | `%LOCALAPPDATA%\MTG Companion\` | `saveFile`, `saveHash`, `savesDir`, `images{...}`, `statusPageShown`, `package` (`Controller.cs:765-832`, `WebUi.cs:908-915`) |
| `updates.json`, `github-token.bin`, `backup\` | same | check time, pending update, DPAPI token, save backups |
| `companion.log` (5 MB then `.1`) | `logs\` or `tmp\` | lights, buttons, update steps (`Controller.cs:20-44`) |
| `bridge.log` (20 MB then `.1`) | `logs\` or `tmp\bridge-live.log` | the bridge's stdout/stderr, `[bridge exited with code N; restarting in 3 s]` lines |
| `log-trim.stamp`, `log-archive\table-log-YYYY-MM-DD.log.gz`, `<log>.old` | `logs\` or `tmp\` (`.old` also in `bridge\`, home) | the 14-day log trim (§7.1): its last run, the archived game history (kept forever), one previous roll of each other log |
| `update-journal.json`, `updates\`, `backup\` | package folder | update bookkeeping |
| `.wslconfig` (+ `.bak-<stamp>`) | `%USERPROFILE%` | only on the **Limit Docker's CPU use** button |
| `TS_Save_N.json` (+ `.png`) | TTS Saves folder | only the table save step |

## 13. Tests

- `--selftest`: the decision logic against canned inputs, in `SelfTest.cs` and `SelfTestWeb.cs`. The earlier spec counted 433
  cases on 2026-11-11; not re-run for this rewrite. Includes the start sequence after a stop through `Controller.WorkOnce` with a
  fake watcher.
- `tests/test_companion_page.js`: the page script in Node with a stub DOM, including the table-tools section against a stub fetch.
- `tests/test_companion_update.js`: a fake GitHub (Node `http`) and the built exe in a temp package, driven by the hidden flags in
  §3, covering kill points during install, tampered signatures, resumed downloads, off-host URLs, token leaks and the
  self-update swap.
- `tests/test_friend_package.js`: the packager's release rules. `tests/test_bridge_ai_tools.js`: the bridge side of §10.
  `tests/test_bridge_hand.js`: the Starting hand (§10.3) on the bridge; `tests/test_table_hand_chat.js`: `mtg hand` in the
  table's chat; `tests/live_hand_check.js` (`tools/live-check.sh exile tests/live_hand_check.js`): the first-priority fix and
  the facts that rule out stacking the library, on the real engine. The selftest covers Stop everything's header and TTS row.
- `tests/no-live-ports.js` refuses and records every connection to 39999, 39998, 48787 and 9443 during tests (`PLAN.md:54`).

Not covered by any automated test, from the sources: a whole friend-mode start on a PC without the repo's stack (ports 9443,
39998 and 48787 are the repo's on the development PC); whether TTS lists a `TS_Save_N.json` that has no entry in
`Saves\SaveFileInfos.json`; how long a real ~1 GB `docker load` takes (a 36 MB tar took 94 s). These are carried over from the
earlier spec, not re-checked.

## 14. Planned but NOT built

Everything here was in the earlier spec or in other specs and has **no code** in `companion/src`.

**DROPPED 2026-11-13** (the user: "Drop the companion extra"): items 1-6 and 8 will not be built. Item 7 is covered by
the Linux/Mac companion (`companion-node`, merged d0dba68). Items 9-11 are not extras and stay open.

1. **Lights and probes**: WSL cores (the fix button exists only as an optional menu action, not a light), ports as a light,
   GPU resets (`nvlddmkm` events), memory and the HP OMEN process, TTS crash/hang events, TTS loaded-object count and
   "focus thieves", disk space, upload meter, `vmmem` CPU, "a docker build is running". None is in `Controller.Names`
   (`Controller.cs:49`).
2. **Engine source-stamp label** (`engine/build-images.sh` `org.mtgtts.source`): not added; the app compares image ids only.
3. **Use of `/health` and `POST /shutdown`**: the bridge now has `GET /health` (`bridge.js:9286-9291`), but the companion reads
   `/state` and `/versions` only; `POST /shutdown` does not exist.
4. **"Ask the table"** (a single `/exec` of `engineStamp()`), reading `Player.log`, and reading the table save's stamp on disk.
5. **Bug-report zip**, notifications beyond the red-light balloon, "Start with Windows", a settings dialog, `startOnLaunch` and the
   other config-file fields of the old design: there is no config file; behaviour is fixed in code.
6. **Own-server mode** and **Cloud mode** for the companion. `docs/cloud-aws-spec.md` §8 budgets 8-12 h for Start / Stop / Status /
   Open DCV / cost readout with SigV4-signed AWS calls and an IAM key stored with DPAPI. Not started, and AWS hosting is paused
   (no AWS account yet).
7. **Mac and Linux.** The user decided cross-platform on 2026-11-06, then "scripts plus a browser page" later that day; neither was
   built. The app is Windows-only (WinForms, Windows named pipes, WMI, registry, `GetExtendedTcpTable`, DPAPI).
8. **Code signing** of the exe, and Apple notarization: not done (`README-FRIEND.txt` tells friends to Unblock).
9. **Updates against a private repository without a token** do not work; with the token they do. Working updates for friends need
   either the repository public or each friend entering a token (decision pending, `docs/release-fix-plan-2026-11-10.md`).
10. **Draw and mill debug tools** (§10.3): built 2026-11-12; they work once the engine images are rebuilt with the `draw`/`mill` ops.
11. `docs/publishing-checklist.md:59` still calls the companion "a later release"; the friend package already ships it.
12. **Starting hand** (§10.3): built 2026-11-13 on what the engine has, so the picked cards come at the first priority, not at the
    mulligan question; a true opening hand needs the engine change written up there (`openingCards`, relay and harness). Chat
    `mtg hand` needs the table script deployed (`tools/make-engine-copy.js`); the page's box needs only the new bridge.

## 15. Changed from the earlier spec

1. **"Nothing here is built yet" was true on 2026-11-05 and is false now.** The code is 7,596 lines (§1).
2. **Technology:** the spec first said C# `csc` (11-05), then Tauri / cross-platform (11-06), then "no app, no signing: Node scripts
   plus a browser status page" (§15 of the old text). **Built: a `csc` WinForms exe that serves a browser status page.** All three
   decisions are partly true; the Node supervisor `tools/start-mtg.js` and the Mac/Linux wrappers do not exist.
3. **Lights:** the old spec had 12 lights plus readouts (§3.1-3.15). **Built: 6 start steps** (Docker, Engine images, Engine stack,
   Table save, Bridge, TTS). WSL cores, ports, GPU, memory and TTS health are not lights (§14.1). Ports are only checked inside the
   Bridge step (`Controller.cs:910`).
4. **Table save** moved from "a light that reads the stamp on disk" to an **installer step** (friend mode) with hash-guarded
   writes into `Saves\`.
5. **Table light** (old §3.9) reads `now.table` and `tableHeardMs` from `/versions` and compares with TTS's start time; no "Ask the
   table" `/exec` button.
6. **Bridge restart loop** is the companion exe itself in `--bridge-loop` mode (friend), not `tools\start-bridge.ps1` plus
   `bridge-loop.cmd`; the `.ps1` path remains for home mode.
7. **Engine start** in friend mode always restarts relay and room after `up -d`, rather than only "when needed", and waits 300 s
   (old: 120 s + 60 s + 90 s).
8. **Game lock**: the old spec proposed `/health` (`phase`); built uses `/state` `started`/`seats` plus the resume-file age
   (`Logic.cs:191-215`), the same answers as the old text's fallback. The old rule 3 (last room list showed `InGame`) is not used.
9. **Fix locking** is by fix id, not per row; **Show the program** and **Open TTS** are never locked.
10. **Stop everything** is `compose down` in friend mode (containers removed), not the old `compose stop`; Docker Desktop is never
    stopped (the old `stopDockerOnEnd` setting does not exist).
11. **Notifications**: red-light balloons only (old: GPU, TTS crash, bridge restart, game over).
12. **Status page and table tools** (old §17, §19) are built as described there; their guards are in §8.2.
13. **Self-update, signing, journal and undo** (old §18) are built as described there; the release-fix of 2026-11-10 (300 s engine
    wait, carry-on after a stop, never skip a step) is in (§5.7).
14. The old build plan and hour estimates (§14 of the old text) and its test plan (live red-causing tests, antivirus scan) are
    dropped; the tests that exist are in §13.
15. The "bridge changes the app needs" list (old §8): `/health` was added to the bridge but is unused; `/shutdown` was not.
16. The earlier §17 menu paragraph omitted "Check for updates" and "GitHub token…", which the tray menu has (`StatusForm.cs:221-224`).

## 16. Open questions for the user

1. Should the six lights stay six, or is the Watcher (GPU / memory / ports / TTS health lights, §14.1) still wanted? The 2026-10-28 and
   2026-11-04 GPU resets, the OMEN leak and the 80k-object limit are the reasons it was designed.
2. Mac and Linux: still wanted, given the exe is WinForms-only and the engine images are x86-64 only? (A Mac host would need arm64
   images and a different supervisor.)
3. Updates for friends while the repository is private: token per friend, make the repository public, or manual zips?
4. Is Cloud mode (§14.6) the first thing to build when AWS hosting un-pauses, or does the exe stay home-only?
5. Should `/health` replace `/state` in the game lock now it exists? It is cheaper (no board build) but is a bridge-version dependency.
