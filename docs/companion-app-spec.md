# Companion app spec: one double-click for game night

Status: spec, rewritten 2026-11-05 (first version 2026-10-20). Replaces the idea in SPEC.md §10b. Builds on
docs/server-setup-spec.md (A–Z steps). Nothing here is built yet.

What changed from the 2026-10-20 version:
- **Technology:** a small C# tray app compiled with the `csc.exe` already in Windows, not Tauri (§9 has the reasons).
- **Scope:** Home mode first, with a status light for every failure we have actually hit (GPU resets, the stale relay
  port after `wsl --shutdown`, the OMEN memory leak, a port held by the VS Code plugin, an old table save).
- **Cloud Forge** (DigitalOcean) moves to a later phase: full hosting was paused by the user on 2026-11-02 (§14).

## 1. Goal

The host double-clicks one program, **MTG Companion.exe**. It:
1. starts everything the table needs, in the right order;
2. shows one status light per part, each with a plain reason and, when red, one button that fixes it;
3. never restarts or changes anything while a game is running.

It replaces `Start MTG.bat`, `Stop MTG.bat`, `tools/start-bridge.ps1` run by hand, and the habit of checking the
Windows event log after a crash. The two `.bat` files stay as a fallback.

Friends who join need nothing but TTS and a Steam invite. The app is only for the host.

## 2. What "everything" is today

Read from the repo on 2026-11-05.

| Part | How it starts today | How we know it works | Known failure |
|---|---|---|---|
| Docker Desktop (WSL2) | `Start MTG.bat` runs `C:\Program Files\Docker\Docker\Docker Desktop.exe`, polls `docker info` for 3 min | `docker info` exits 0 | slow start; WSL not on 2 cores |
| WSL limits | `%USERPROFILE%\.wslconfig`: `processors=2`, `memory=8GB` | `docker info --format {{.NCPU}}` says 2 | a change needs `wsl --shutdown`; on 3 cores TTS crashed |
| Engine images | `bash engine/build-images.sh` (about 20 min) | `docker image inspect mtg-forge-node:exile mtg-relay:exile` | missing; container still on an old image after a retag |
| Relay (`stack-relay-1`) | `docker compose -f stack/compose.yml up -d` | the image's own health check (`curl -fsS http://localhost:9444/health` inside the container, every 15 s; it is in the image, not in `compose.yml`). The room container has none | after `wsl --shutdown` the Windows-side `127.0.0.1:9443` forward goes stale: health stays "healthy" but games fail at setup; fix `docker restart stack-relay-1` |
| Forge room (`stack-forge-room-1`) | same compose file | relay's room list shows `tts-commander` in `Lobby` | a room left from an earlier game refuses a new start; `Start MTG.bat` restarts relay and room every time |
| Web client (`stack-web-1`) | same compose file | not needed for TTS | none; ignored by the app |
| Bridge (`bridge/bridge.js`) | `tools/start-bridge.ps1`: a hidden `cmd` loop (`tmp\bridge-loop.cmd`) that restarts node 3 s after it exits; logs to `tmp\bridge-live.log` | `GET http://127.0.0.1:48787/versions` | port 39998 taken (VS Code / Atom TTS plugin): node exits at once and the loop retries forever |
| TTS | `steam://rungameid/286160` | process `Tabletop Simulator.exe`; it listens on `127.0.0.1:39999` (seen with a table loaded; at the main menu: not checked) | GPU driver resets (130+ since 09-12), hangs, crash past ~78k loaded objects |
| The table | the host loads **Mock MTGA 4 player** (`Saves\TS_Save_1.json`) by hand: TTS has no way to open a save from outside | the table's `engineStamp()` matches `stack/deployed.json` `table` | an older save, or a Save from a session opened before a deploy |
| Deploy record | `node tools/deploy.js` (TTS closed, no game) writes `stack/deployed.json` | `GET /versions` → `outOfStep` | parts built separately drift apart |
| PC health | nothing | — | HP OMEN background process leaking to ~100 GB; NVIDIA resets (`nvlddmkm` 153) |

Ports, all on `127.0.0.1`:
- **39998:** the bridge listens; TTS sends to it (TTS's External Editor API).
- **39999:** TTS listens; the bridge sends Lua and messages to it.
- **48787:** the bridge's debug HTTP (refuses any request with an `Origin` header or a foreign `Host`).
- **9443:** the relay, forwarded by `com.docker.backend.exe`.
- **8080:** Manabrew's web client (optional, not watched).

## 3. Lights

One row per light. Colours:
- **Green:** works.
- **Amber:** works, but something is off or unknown. Play is possible. The row says what and why.
- **Red:** this part is down or will make games fail. The row offers one fix button.
- **Grey:** not checked yet, or not started on purpose (after "End game night").

Every fix button that restarts, rewrites or kills something is **locked while a game is running** (§5) and asks
once before it acts (one sentence: what it does, how long, what it touches). Read-only buttons (open log, open folder,
explain) are never locked.

All probes run on one background thread with their own timer. A probe never overlaps itself; a probe that times out
counts as a failed read, not as red, until it fails twice in a row. Light changes are logged (§10).

Two rules every probe follows (added in review):
- **Slow is not down.** Only "connection refused" (nothing listens) or "no such process" means a part is down. A
  timeout means "can't tell". On 2026-11-05, with a game on, PowerShell's `Invoke-WebRequest` took 35–41 s for
  `/stats`, `/state` and `/log`, while `curl` a minute later took 0.01–0.04 s. The cause wasn't pinned (PowerShell's
  client or a busy bridge). Either way, one slow answer must never unlock a fix.
- **No proxy.** Every `HttpWebRequest` sets `Proxy = null`. With the default proxy the first request took 352 ms,
  with `null` 3 ms (measured here).

### 3.1 Docker

- **Checks:** the Docker engine answers.
- **Probe:** `GET /info` on Docker's engine API over the named pipe `\\.\pipe\dockerDesktopLinuxEngine` (the
  `desktop-linux` context), 10 s timeout. It gives `ServerVersion`, `NCPU` and `MemTotal`, like
  `docker info --format "{{.ServerVersion}} {{.NCPU}} {{.MemTotal}}"` (which printed `29.8.2 2 8330964992` here), but
  with no child process. Checked 2026-11-05: the pipe answers a plain `HTTP/1.0` request from a normal user
  (`/_ping`, `/info`, `/containers/<name>/json`, `/images/<name>/json`). The CLI is the fallback if the pipe is missing.
  Also whether a `Docker Desktop` process exists.
- **Never probe with `docker desktop status`:** on 2026-11-05 it hung for over 2 minutes here.
- **Every:** 15 s (60 s once green for 5 minutes; back to 15 s on any failure).
- **Green:** exit 0.
- **Amber:** exit not 0 but the `Docker Desktop` process exists ("Docker is starting").
- **Red:** exit not 0 and no `Docker Desktop` process, or still not answering 180 s after the app started it.
- **Fix:** **Start Docker Desktop.** Runs the Docker Desktop exe (§11 finds it), then polls `docker info` every 3 s for
  up to 180 s. Not locked: Docker being down means no game is running on it.

### 3.2 WSL cores

- **Checks:** Docker's VM has the cores and memory we chose (default 2 cores, 8 GB) so Forge can't take CPU from TTS.
- **Probe:**
  - read `%USERPROFILE%\.wslconfig`: the `[wsl2]` section's `processors=` and `memory=` (on file change, and every 60 s);
  - the `NCPU` from the Docker probe.
- **Every:** 60 s.
- **Green:** file says 2 and Docker reports 2.
- **Amber:** file says 2 but Docker reports another number: "the setting is saved but WSL hasn't restarted yet".
- **Red:** no file, no `processors=` line, or a number other than 2.
- **Fix (red):** **Set 2 cores.** Copies the file to `.wslconfig.bak-YYYYMMDD-HHMM`, sets `processors=2` and
  `memory=8GB` in `[wsl2]` (other lines kept), then offers the amber fix.
- **Fix (amber):** **Restart WSL now** (about 2 minutes). Locked during a game. Warns that it stops every WSL
  program, not only Docker, including a `docker build` in progress (§3.14 shows one). On 2026-11-05 the containers
  came back by themselves after `wsl --shutdown` (`restart: unless-stopped`); how Docker Desktop reacts each time (it
  may restart its VM or show an error) is not checked, so step 3 just waits for `docker info` either way. Steps:
  1. stop the bridge;
  2. `wsl --shutdown`;
  3. start Docker Desktop and wait for `docker info` (180 s);
  4. `docker compose -f stack/compose.yml up -d`;
  5. `docker restart stack-relay-1` (the stale-forward trap, §3.4);
  6. restart the room and the bridge (start sequence steps 6–8, §4).

### 3.3 Engine images

- **Checks:** the two images exist, the containers run them, and they match the last deploy and the source.
- **Probe:**
  - `GET /images/mtg-forge-node:exile/json` and `GET /images/mtg-relay:exile/json` over the pipe (§3.1), 10 s; read
    `Id`, `Created` and `Config.Labels` from the JSON. CLI fallback:
    `docker image inspect --format "{{.Id}} {{.Created}} {{json .Config}}" mtg-forge-node:exile mtg-relay:exile`.
    Checked 2026-11-05: `{{.Config.Labels}}` and `{{json .Config.Labels}}` both fail ("map has no entry for key
    Labels") on our images, which have no labels; `{{json .Config}}` works;
  - the container image ids from the container probe (§3.4);
  - `stack/deployed.json` `node` and `relay`;
  - the source stamp: see the proposal below.
- **Every:** 5 minutes, and at once when `stack/deployed.json` or `engine/*.patch` changes (file watcher).
- **Green:** both images exist; each container runs the image its tag points at; both match `deployed.json`.
- **Amber**, each with its own sentence:
  - "a container runs an older image than its tag": the tag was moved but the container wasn't recreated;
  - "the engine isn't the deployed one": the image differs from `deployed.json`;
  - "the engine source changed since this image was built": source stamp mismatch;
  - "can't tell whether the image matches the source": no stamp label, which is every image today.
- **Red:** an image is missing.
- **Fix (red):** **Build the engine** (about 20 minutes, several GB of disk). Opens a visible Git Bash window running
  `bash engine/build-images.sh` (the default tag `exile`). Locked during a game. Never runs by itself.
- **Fix ("older image than its tag"):** **Recreate the engine containers** (about 30 s):
  `docker compose -f stack/compose.yml up -d --force-recreate relay forge-room`. Locked during a game. The confirm
  says plainly: "this switches to an engine that `deploy.js` hasn't tested. **Deploy…** is the safe way." A tag moves
  when someone runs `engine/build-images.sh` with the default tag `exile`: the build itself never touches the running
  containers, but the next recreate does.
- **Fix ("not deployed" / "source changed"):** **Deploy…** explains that `node tools/deploy.js` needs TTS closed and
  takes several minutes for its test gates, then runs it in a visible window. Locked during a game and while TTS runs.
- **Proposal, needed for the source stamp:** `engine/build-images.sh` adds `--label org.mtgtts.source=<sha8>` to both
  `docker build` lines, where sha8 is the first 8 hex of SHA-256 over `MANABREW_COMMIT`, `FORGE_COMMIT`,
  `manabrew.patch` and `forge.patch`. The app computes the same over the same four things. Images built straight from
  the `manabrew/` checkout (the developer's way) carry no label and stay at "can't tell".

### 3.4 Relay

- **Checks:** the relay container runs, and a client on Windows can log in through `127.0.0.1:9443`. The second part
  catches the stale port forward after `wsl --shutdown`: the container's own health check stays "healthy" while every
  connection from Windows drops at once.
- **Probe:**
  1. Containers (shared with §3.3 and §3.5), 8 s timeout:
     `docker inspect --format "{{.Name}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.Image}}|{{.RestartCount}}|{{.State.StartedAt}}" stack-relay-1 stack-forge-room-1`.
     A missing container makes `docker inspect` exit 1 but still print the other line: parse per line (checked
     2026-11-05: "error: no such object", exit 1, the other lines printed). Preferred: `GET /containers/<name>/json`
     over the pipe (§3.1), one per container, 404 when missing. `stack-forge-room-1` has no health check, so its
     health field is empty.
  2. Login from Windows: a WebSocket to `ws://127.0.0.1:9443` (3 s to open), send
     `{"type":"Authenticate","username":"companion-<4 random>","password":<key>,"service":false,"client_platform":"unknown","engine_gate":"unknown","client_version":"3.56.0"}`,
     wait for `AuthResult` with `success: true` (3 s), send `{"type":"ListRooms"}`, wait for `RoomList` (3 s), close.
     The key is `MANABREW_SERVER_KEY` from `stack/.env` if that file exists, else `tts-local` (the compose default).
     These are the same messages the bridge sends (`Seat.connect`, `bridge.js`; checked).
     Leftover sessions, from reading the relay source (`manabrew-server/src/cleanup.rs`, not tried live): a player who
     closes while in no room is removed at once ("removed (was not in a room)"). Each login and close also sends a
     player list to every client in the lobby, and writes an `[auth]` and a `[disconnect]` line to the relay log: about
     240 lines an hour at one probe per 30 s. If the socket drops without a close, the relay marks it gone after 180 s.
     Always send a proper close.
- **Every:** containers 10 s. Login 30 s when no game runs. During a game the login probe is skipped: the bridge's own
  seat links prove the relay (§3.6, from `/health`), and we add no traffic to a live game.
- **Green:** container `running` and `healthy`, login and room list within 9 s.
- **Amber:** health `starting`; or the restart count rose since the app started ("the relay restarted by itself").
- **Red:**
  - container missing or not running → fix **Start the engine**: `docker compose -f stack/compose.yml up -d` (120 s);
  - container healthy but the login fails (refused, closed, or no `AuthResult`) → "Relay is up but games will fail at
    setup" → fix **Restart relay and room** (about 20 s):
    `docker compose -f stack/compose.yml restart relay forge-room`, then the room wait of §4 step 6. Restarting the room
    alone leaves the old room on the relay, so both go together, as `Start MTG.bat` already does.
  - `AuthResult` with `success: false` → "the relay refused the key": no fix button; the row names `stack/.env`.
- Both fixes are locked during a game.
- Also red, from the bridge log: "relay connection closed before the game started" in `tmp\bridge-live.log` in the
  last 5 minutes means the same stale forward. Same fix. That line comes during setup, which locks fixes (§5), so the
  row says: "type `mtg reset` in TTS chat, then press the fix". After the reset there is no game object and the button
  unlocks.

### 3.5 Forge room

- **Checks:** the room `tts-commander` exists on the relay and is free for a new game.
- **Probe:** the `RoomList` from the relay login (§3.4), plus the room container line. The bridge picks the room
  by `room_name` and wants `status: "Lobby"` (`bridge.js`, `RoomList` handler). Manabrew's `RoomStatus` has `Lobby`
  and `InGame`; anything else counts as busy.
- **Every:** with the relay login (30 s, skipped during a game).
- **Green:** `Lobby`; or `InGame` while the bridge says a game is running (that is our game).
- **Amber:** container restarted by itself since the app started (restart count rose).
- **Red:**
  - room missing for 60 s while the container runs → fix **Restart the room**:
    `docker compose -f stack/compose.yml restart relay forge-room`;
  - `InGame` while the bridge says no game → "a room left over from an earlier game; a new start will be refused" →
    same fix.
- Locked during a game.
- The node's log line "self-hosted-node is OUT OF DATE" (Manabrew's own updater, every 5 minutes) is about upstream
  builds. Our image is a custom build on purpose: the app ignores that line.

### 3.6 Bridge

- **Checks:** the bridge process runs, answers on 48787, is the deployed code, and isn't crash-looping.
- **Probe:**
  - process: WMI `SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='node.exe'`, kept if the command line
    has `bridge.js` as a whole file name (`bridge.js` after a space, quote, `\` or `/`), every 15 s. Stricter than
    `tools/stop-bridge.ps1`, whose `*bridge.js*` also matches `bridge/echo-bridge.js` and any `*-bridge.js` test fake.
    A WMI query that fails or times out means "can't tell", never "no process";
  - liveness: `GET http://127.0.0.1:48787/stats`, 5 s timeout, every 5 s. Cheap: it returns a small counter object
    (8–42 ms with `curl` on 2026-11-05);
  - game and seats: `GET /health` once the bridge has it (proposal, §8); until then `GET /state` (5 s), whose
    `started` is what `tools/deploy.js` already uses to tell a game is running;
  - version: `GET /versions`, 15 s timeout (60 s). Not more often: each call runs `docker inspect` (with its own 8 s
    timeout in `bridge/versions.js`); it took 3.1–3.7 s with `curl` on 2026-11-05. It gives
    `now.bridge` and `deployed.bridge`, `outOfStep` (the bridge's own sentences) and `waiting` (source edited since
    the deploy);
  - crash count: reads new lines of `tmp\bridge-live.log` since the last read (shared read, from the last offset) and
    counts `[bridge exited with code` lines. The log is appended forever (4.75 MB, 135 exit lines on 2026-11-05),
    so at app start read only the last 1 MB; if the file got smaller, start again from 0.
- **Every:** as above.
- **Green:** `/stats` answers, no exits in the last 10 minutes, `now.bridge` equals `deployed.bridge`.
- **Amber:**
  - `outOfStep` or `waiting` not empty: the row shows the bridge's own sentence, e.g. "The bridge isn't the deployed
    one: restart it between games";
  - 1–2 exits in the last 10 minutes ("restarted itself; the game resumes if it was back within 50 s").
- **Red:**
  - no process → fix **Start the bridge**: runs `powershell -NoProfile -ExecutionPolicy Bypass -File
    tools\start-bridge.ps1` (as `Start MTG.bat` does), then waits up to 20 s for `/stats`. Not locked: a dead
    bridge can't be hurt. **But `start-bridge.ps1` runs `stop-bridge.ps1` first**, so it kills any bridge that is in
    fact alive. Right before it runs, the app checks again, all three: no bridge `node.exe` (WMI answered), nothing
    listening on 39998 or 48787 (TCP table), and `/stats` refused. Any "can't tell" cancels it;
  - process but `/stats` times out on every try for 60 s → "bridge hung" → fix **Restart the bridge**
    (`tools\stop-bridge.ps1`, then start). During a game (§5) it asks with: "the game is lost unless the bridge is back
    within 50 s of its last save". A hung bridge stops saving, so after a minute the game is usually lost already;
  - 3 or more exits in 10 minutes → "crash loop", with the last 5 log lines shown. If port 39998 is held by another
    program, that is the cause (§3.7) and the row says so.
- **Restart rule:** the restart loop in `bridge-loop.cmd` brings a crashed bridge back by itself, and the bridge
  rejoins a running game if it is back within 50 s (`resumeGame`). The app does not add a second loop. It never
  restarts a bridge that answers, during a game.
- **Caution, shown in the amber text:** a bridge restart mid-game redraws the whole table. Above ~80k loaded objects
  that redraw was followed by an NVIDIA reset (2026-10-28).

### 3.7 Ports

- **Checks:** each port is held by the right program.
- **Probe:** `GetExtendedTcpTable` (iphlpapi.dll, listeners with owner PID, no child process), PID → process name.
- **Every:** 10 s.
- **Expected owners:**
  - 39998 and 48787: the bridge's `node.exe` (same PID);
  - 39999: `Tabletop Simulator.exe` (only while TTS runs);
  - 9443: `com.docker.backend.exe` (seen 2026-11-05) or `wslrelay.exe`.
- **Green:** every listener present is the expected owner.
- **Amber:** 39999 not listening while TTS runs. Seen on 2026-11-05: `Tabletop Simulator` holds 39999 with a table
  loaded. **Not checked:** whether the main menu alone opens it (checking needs leaving the table). The bridge's own
  log line "TTS not reachable on 39999 (is a game loaded?)" suggests only a loaded game does. Until checked, this is
  amber only after TTS has run for 2 minutes, and its text says "or no table is loaded yet".
- **Red:** 39998 or 48787 held by any other program. The row names it, e.g. "`Code.exe` holds 39998: close the VS Code
  TTS extension". Button **Show the program** (opens Task Manager details). No kill button: it is the host's program.

### 3.8 TTS

- **Checks:** TTS runs and responds.
- **Probe:**
  - `Process.GetProcessesByName("Tabletop Simulator")`: PID, working set, `Responding` (5 s);
  - loaded objects: the last "Loaded Objects now: N" in
    `%USERPROFILE%\AppData\LocalLow\Berserk Games\Tabletop Simulator\Player.log`, read from the last offset
    (30 s), as `tools/gpu-watch.ps1` does. TTS starts a new `Player.log` at each launch (13 KB, 30 such lines on
    2026-11-05 evening): when the file is smaller than the offset, read from 0. The number is Unity's loaded-object
    count, not TTS's object count;
  - crashes: Application log, events 1000 (crash) and 1002 (hang) whose message has "Tabletop", in the last hour (60 s),
    as the crash watcher does.
  - focus thieves: a `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)` callback (no polling). When TTS loses the foreground
    to a window of `Razer*`, `Omen*` or `NVIDIA*` processes (the list is in the config), log it with the process name.
- **Every:** as above.
- **`Responding` flickers:** on 2026-11-05 one sample said `False` and the next four, 2 s apart, said `True`. TTS's
  main thread stalls for a moment on big redraws (and about 360 ms per exec). Count "not responding" only when every
  sample over the whole window says so.
- **Green:** running and responding.
- **Amber:**
  - not running (TTS closed is normal) → button **Open TTS** (`steam://rungameid/286160`);
  - not responding for 15 s;
  - loaded objects above 78,000: "past the point where the GPU resets came; save, then quit and reopen TTS after
    this game". TTS starts at about 60k on the user's table; resets came at 81.7k–84k, one with the table idle
    (memory note, 2026-10-28). On 2026-11-05 evening it read 81,386;
  - a focus thief took the screen from TTS in the last 10 minutes: "Razer Central popped up over TTS (3 times
    tonight): turn off its notifications". No button: it is the host's program. Not in the repo's notes; added from
    the lead's list of past trouble.
- **Red:**
  - not responding for 60 s → fix **End TTS and open it again**. Kills the process, waits until it is gone (the Steam
    link is ignored while the old process lives), runs the Steam link, then tells the host to load Mock MTGA 4 player.
    Not locked during a game: a hung TTS has already stopped the game for everyone; the bridge sends the running game
    back to the table when TTS says "game loaded". Asks first, and the question says: "Anything added to the table
    since your last save (an imported deck) is lost. TTS can't save while hung." Not offered in the first 3 minutes
    after TTS starts or after "game loaded": loading a big table stalls TTS for a while (how long: not measured);
  - a crash or hang event in the last 10 minutes and no TTS process → **Open TTS**, with the same load hint.

### 3.9 Table

- **Checks:** the table loaded in TTS is the engine table, at the deployed version, and talking to the bridge.
- **Probe:**
  - the table's version stamp: `now.table` from `GET /versions` (60 s), or `table.stamp` from `/health` (§8);
  - the console lines from `GET /log` (30 s): the last `TTS: game loaded` time. The lines start with a UTC time of
    day and no date (`[00:24:44.093] TTS: game loaded` on 2026-11-05 at 19:24 local), so parse them as UTC and
    roll back a day when the time is ahead of now.
- **Green:** the stamp equals `deployed.table`.
- **Amber:**
  - TTS loaded a game over 60 s ago and the bridge has no stamp: "no engine table loaded, or it hasn't spoken yet:
    load **Mock MTGA 4 player**". The table sends its stamp at load and with each check, so a bridge restarted under a
    loaded table doesn't know it until the next one. Button **Ask the table**: one `POST /exec` of
    `return engineStamp and engineStamp() or "none"`. Only on click, never polled: each exec freezes TTS about 360 ms;
  - stamp `"dev"`: "built from source, not deployed".
- **Red:** stamp `null` (older than stamps) or a stamp other than `deployed.table`: "this table isn't the deployed one:
  load the save again, and don't save over it from an older session" (the bridge's own words).
- **Fix:** none can load a save from outside TTS. The row says how: Create → Multiplayer (or Singleplayer) →
  Games → Saved Games → Mock MTGA 4 player.

### 3.10 Table save on disk

- **Checks:** the save file holds the deployed script, so loading it gives the right table.
- **Probe:** on file change (watcher on `Saves\`), and at start: read `TS_Save_1.json` and find
  `function engineStamp() return "<stamp>" end` in its Global `LuaScript`. In the raw file the quotes are escaped,
  because the script is a JSON string: the text is `function engineStamp() return \"f9208197\" end` (checked
  2026-11-05). Either parse the JSON first or match the escaped form. The file is about 1.1 MB. Compare with
  `deployed.table`. Also its sha8 against
  `deployed.save`: informative only, since any Save in TTS changes the file.
- **Green:** stamps equal.
- **Amber:** the file changed since the deploy but the stamp is still equal (the host saved their table: fine).
- **Red:**
  - file missing → "the table save is gone". Button **Open the backups folder** (`tmp\backup`);
  - stamp differs → "the save on disk is older or newer than the deploy". Fix **Deploy…**, as in §3.3.

### 3.11 GPU resets

- **Checks:** NVIDIA driver resets and blue screens, which crash TTS on this PC (130+ resets since 09-12; card RTX 4060).
- **Probe:** `EventLogReader` on the System log (works without admin; checked 2026-11-05):
  - provider `nvlddmkm`, ids 153 (reset), 13 and 14 (engine exceptions);
  - `Display` id 4101 (driver stopped responding);
  - `Microsoft-Windows-WER-SystemErrorReporting` id 1001 (blue screen, logged after the reboot).
  Filter by provider, not by id alone: id 153 alone also matches Kernel-Boot events.
- **Every:** 60 s, the last 24 hours.
- **Green:** none in 24 hours.
- **Amber:** id 13/14 in the last hour, or any reset in the last 24 hours (with count and last time).
- **Red:** a 153, 4101 or 1001 in the last hour.
- **Fix:** no button can fix a driver. The row gives:
  - **What helps:** cap TTS's frame rate; relaunch TTS between games once past ~78k objects; save before risky moves;
  - **Start GPU logger:** runs `tools/gpu-watch.ps1` hidden, so the next reset shows what led up to it;
  - **Copy the events:** the event lines to the clipboard.
- Grey on PCs without an `nvlddmkm` provider.

### 3.12 Memory

- **Checks:** Windows has commit memory left, and HP OMEN's background process isn't leaking (it reached ~98 GB on
  2026-10-22; programs then failed to start and test tables died silently).
- **Probe:**
  - `GlobalMemoryStatusEx`: used share of commit (page file total minus free);
  - `OmenCommandCenterBackground` private bytes (222 MB on 2026-11-05);
  - System event 2004 (Resource-Exhaustion-Detector) in the last hour;
  - free space on the drive holding Docker's disk image and the repo (`GetDiskFreeSpaceEx`): an engine build needs
    several GB.
- **Every:** 30 s.
- **Green:** commit under 85%, OMEN under 4 GB.
- **Amber:** commit 85–95%, OMEN 4–16 GB, or under 10 GB of free disk.
- **Red:** commit over 95%, OMEN over 16 GB, or event 2004 in the last hour.
- **Fix:** **Stop the OMEN background process.** Asks every time: it is the host's software, and it comes back at the
  next boot. Not locked during a game: running out of memory ends the game anyway. If OMEN isn't the biggest process,
  the row names the top three by private memory instead, with no button.

### 3.13 Game (not a light)

A readout at the top: "No game", "Setting up", "Game on: turn 6, 4 seats (2 AI)", "Game over". It drives the lock in §5.

### 3.14 Readouts (no colours)

- TTS: memory (MB), CPU %, loaded objects.
- Engine: CPU % of the `vmmem` / `VmmemWSL` process (`vmmemWSL` here, 3.6 GB private on 2026-11-05), and
  "a `docker build` is running" when a `docker.exe` with `build` in its command line exists: a build shares the 2
  WSL cores with Forge. One was running on 2026-11-05 evening while a game was on.
- Upload while a game runs: sum of `Network Interface \ Bytes Sent/sec` every 1 s, shown as Mbps (average and peak
  over 5 minutes), the logic of `tools/net-upload-meter.ps1`.
- Bridge: uptime, restarts tonight.

### 3.15 The app's own cost

TTS's CPU is the scarce thing on this PC (6 cores, TTS crashed with the engine on 3 WSL cores). Targets:
- average CPU under 0.5% of one core;
- no more than one child process (`docker`, `powershell`) every 10 s on average. With the CLI, the Docker and
  container probes alone would start about 7 a minute; over the engine pipe (§3.1) they start none, so the pipe is
  the plan and the CLI only the fallback;
- no TTS exec while polling;
- polls back off to their slow interval when the window is hidden and everything is green.

## 4. Start

Double-clicking the exe starts the sequence by itself (setting `startOnLaunch`, default on). Pressing **Start game
night** runs it again; each step skips what is already fine.

| Step | Does | Timeout | On failure |
|---|---|---|---|
| 1. Preflight | Finds the repo, Node 22+, Docker CLI; reads the config; checks memory (§3.12) | 5 s | stop; red row with the missing piece and a download link |
| 2. Docker | `docker info`; if down, start Docker Desktop and poll every 3 s | 180 s | stop; Docker red |
| 3. WSL cores | §3.2 check only; never changes anything here | 5 s | go on; amber or red stays shown |
| 4. Images | both images exist | 10 s | stop; Images red, **Build the engine** offered |
| 5. Engine up | `docker compose -f stack/compose.yml up -d --no-recreate`, then wait for relay `healthy`. `--no-recreate` because a plain `up -d` replaces a container whose tag has moved, which would quietly start an engine `deploy.js` never tested (§3.3) | 120 s + 60 s | stop; Relay red |
| 6. Fresh room | Only if no game runs **and** (room not `Lobby` **or** the login fails): `docker compose ... restart relay forge-room`; then ask for the room list every 2 s until `Lobby` | 60 s + 90 s | stop; Forge room red |
| 7. Relay from Windows | the login probe (§3.4), 3 tries 2 s apart. If it fails and no game runs: restart relay and room once by itself, probe again | 30 s | stop; Relay red, "games will fail at setup" |
| 8. Bridge | `/stats` answers, or a bridge process exists, or 39998/48787 are held → keep it. Only when all three say "none" (§3.6): `tools\start-bridge.ps1`, then wait for `/stats`. Never decide on `/versions`: it can take seconds | 20 s | stop; Bridge red with the last 5 log lines |
| 9. TTS | running → keep it; else the Steam link, wait for the process | 120 s | go on; TTS amber, **Open TTS** |
| 10. Hint | "Load Mock MTGA 4 player in TTS"; the Table light turns green when the table speaks | — | — |

- A cold start is about 2–4 minutes, mostly Docker. A warm start (all up) is under 10 s.
- `Start MTG.bat` restarts the relay and room every time and then waits 15 s. Step 6 does it only when needed, and
  waits for `Lobby` instead of a fixed time.
- **Started while a game runs** (e.g. the app was closed and reopened mid-game): steps 5–7 become checks only. Nothing
  restarts; the app only takes over watching.
- **A bridge started elsewhere** (`Start MTG.bat`, a terminal): step 8 keeps it. Port 39998 is single-owner, so a
  second bridge would only crash-loop.
- A step that fails stops the steps after it. The window shows the failed step in red, its fix button, and **Try again
  from here**.
- Cancel is allowed at any step. A cancelled step is left as it is (e.g. Docker keeps starting).

## 5. During a game: what never happens by itself

**How the app knows a game is running.** Three answers, not two: **Game on**, **No game**, **Can't tell**. Can't tell
locks exactly like Game on.

"Game on" if any of:
1. the bridge answers and says so: `/health` `phase` is `setup` or `running` (proposal, §8). Until then, from
   `/state`: `started` true, **or** `seats` not `null`. `/state` gives `started: false` both while a game is being set
   up and after it ends; `seats` is `null` only when there is no game object at all (checked in `bridge.js`). Without
   `/health`, setup and over look alike (a hint: in setup no seat has a `turn` yet), so both lock until "mtg reset";
2. the bridge doesn't answer, but `tmp\bridge-game.json` was written in the last 60 s. The bridge rewrites it every
   5 s while a game runs (`saveResume`), so a bridge that just crashed mid-game still counts as a game. Read its
   `savedAt` inside the file as well as the file time, and use the newer;
3. the last room list showed `tts-commander` `InGame` and the bridge has not answered since.

"Can't tell" when the bridge process exists (or 48787 is held) but `/stats` and `/state` time out, and rules 2–3 don't
say "Game on". A hung bridge stops writing `bridge-game.json`, so after 60 s rule 2 no longer fires; that must not turn
into "No game".

"No game" only when the bridge answers `/state` with `seats: null`, or when there is no bridge process, nothing on
48787 (refused) and no fresh `bridge-game.json`. This matches `tools/deploy.js` (`mustBeIdle`: only a refused
connection means no bridge; any other error stops it with "can't tell").

What `bridge-game.json` does not cover (from `saveResume`): games still in setup, finished games, and test games
started with `autoplay`. It is never written for those, so for them only rules 1 and 3 count. A stale file from an old
crash stays on disk until the next "mtg reset"; the 60 s age rule ignores it.

**While a game is on, the app never by itself:**
- restarts Docker, WSL, the relay, the room or a bridge that answers;
- runs `tools/deploy.js`, builds or retags images, or recreates containers;
- edits `.wslconfig`, a save, or anything in the repo;
- kills or relaunches TTS;
- sends Lua to TTS (`/exec`) or reloads the table (no Save & Play, ever);
- stops another program (OMEN, VS Code).

The lock covers both the app's own steps and the fix buttons. A locked button shows "A game is on (turn 6). Do this
after the game."

**Allowed during a game:**
- every probe except the relay login;
- the bridge's own restart loop bringing back a crashed bridge (it rejoins within 50 s);
- after asking: **End TTS and open it again** for a TTS that has been hung 60 s; **Stop the OMEN background process**
  when memory is red. Both are already ending the game if left alone.

**After a game:** when the phase becomes "over" or "none", fixes that waited are listed once: "Game over. 2 things
are waiting: restart the bridge (deployed version); TTS is at 81,200 objects: save, quit and reopen it. [Restart the
bridge now]". Nothing runs without that click. The app never kills a TTS that responds: closing it loses anything not
saved, so that one stays a reminder for the host to do.

**What can never reach the table:** the app never connects to 39999 itself and never sends External Editor message 1
("Save & Play", which reloads the table and saves the live table over `TS_Save_1.json`; memory note
tts-push-wipes-table). It never runs `tools/tts-push-*.js`. Its only Lua is the one-line **Ask the table** through the
bridge's `/exec` (message 3, execute only). `deploy.js` writes the save on disk only, and refuses while TTS runs.

## 6. Stop

**End game night** (button and tray menu):
1. If a game is on: "A game is running (turn 6). Ending stops it for everyone." Cancel is the default.
2. Stop the bridge: `tools\stop-bridge.ps1` (the loop first, then node). Once `POST /shutdown` exists (§8): call it
   first, so each seat leaves its room cleanly, then the script.
3. `docker compose -f stack/compose.yml stop` (60 s). Containers are kept; the next start is quick.
4. If the setting `stopDockerOnEnd` is on: `docker desktop stop --timeout 120`. Checked 2026-11-05: Docker Desktop
   4.95.0 has `docker desktop start` and `stop` (both take `--detach` and `--timeout`; `stop` also `--force`). Only
   the help was read; neither was run. If the command is missing (older Docker Desktop), leave Docker running.
   Default off.
5. TTS is left alone, as `Stop MTG.bat` does.
6. All lights grey except PC health (§3.11, §3.12), which keep running.

**Quitting the app** (tray → Quit):
- with nothing running, it just closes;
- otherwise it asks: **Leave everything running** (default) / **End game night, then quit** / Cancel.

The bridge doesn't depend on the app. It runs in its own hidden `cmd` loop, so closing or updating the app never
touches a game. The next app start finds the bridge again (§4 step 8).

Windows signing out or shutting down: the app logs it and exits at once. No stop steps: Windows ends the processes.

## 7. Screens

### 7.1 Main window (about 560 × 600, resizable; closing it hides it to the tray)

```
+---------------------------------------------------------------+
| MTG Companion                                      [_] [x]    |
+---------------------------------------------------------------+
|  GAME ON: turn 6, White's main phase, 4 seats (2 AI)          |
|  Fixes that restart things are locked until the game ends.    |
+---------------------------------------------------------------+
|  ( ) Docker        up, 2 CPUs                                 |
|  ( ) WSL cores     2 of 2                                     |
|  (!) Engine        can't tell whether it matches the source   |
|  ( ) Relay         reachable, 1.2 s login                     |
|  ( ) Forge room    in game                                    |
|  ( ) Bridge        3e533e72 (deployed), up 2 h 14 min         |
|  ( ) Ports         39998 bridge, 39999 TTS, 9443 Docker       |
|  ( ) TTS           1,512 MB, 62,400 objects                   |
|  ( ) Table         f9208197 (deployed)                        |
|  ( ) Table save    f9208197 (deployed)                        |
|  (X) GPU           driver reset 14 min ago (3 today)  [Help]  |
|  ( ) Memory        commit 64%, OMEN 222 MB                    |
+---------------------------------------------------------------+
|  Upload 3.1 Mbps (peak 9.8)   TTS CPU 38%   Engine CPU 21%    |
+---------------------------------------------------------------+
| [Start game night] [End game night] [Open TTS]                |
| [Logs] [Save a bug report]                     [Settings]     |
+---------------------------------------------------------------+
```

- `( )` is a filled coloured dot in the real window; `(!)` amber, `(X)` red. The colour is never the only sign: each
  row's text says the state, for colour-blind hosts.
- Clicking a row opens its detail under it: what was checked, the raw probe result, when, and the fix button.

### 7.2 A red row opened

```
|  (X) Relay         up, but games will fail at setup           |
|      The relay container is healthy, but a login from this    |
|      PC was closed after 19 ms. This happens after WSL or     |
|      Docker restarts.                                         |
|      [Restart relay and room]  about 20 s, no game is on      |
|      Last checked 20:41:07. [Copy details]                    |
```

### 7.3 Starting

```
|  Starting game night                          [Cancel]        |
|  [done]  1 Preflight                                          |
|  [done]  2 Docker            (started it, 74 s)               |
|  [done]  3 WSL cores                                          |
|  [done]  4 Engine images                                      |
|  [ .. ]  5 Engine up         waiting for the relay, 12 s      |
|  [    ]  6 Fresh room                                         |
|  ...                                                          |
```

### 7.4 Settings

The fields of §11's config file that a host would change: start on launch, open TTS on start, stop Docker on end,
WSL cores and memory, save file, notifications on/off, and "Start with Windows" (a shortcut in the user's Startup
folder; off by default).

### 7.5 Tray icon

A 16 × 16 icon drawn at run time (no image files): a card shape with a coloured dot.

| Icon | Means | Tooltip |
|---|---|---|
| grey dot | stopped | "MTG: stopped" |
| blue dot, turning | starting or running a fix | "MTG: starting (step 5 of 10)" |
| green dot | all green | "MTG: ready" or "MTG: game on, turn 6" |
| amber dot | at least one amber, no red | "MTG: 1 warning: Engine" |
| red dot | at least one red | "MTG: Relay down" |

Tray menu: Open · Start game night · End game night · Open TTS · Open logs · Quit. A left click opens the window.

### 7.6 Notifications

Windows notifications (balloon tips) only for:
- a light turning red (one per light per 10 minutes);
- a GPU reset or TTS crash event (always);
- the bridge restarting itself during a game ("the game resumed" or "the game did not come back");
- the start sequence finishing or failing while the window is hidden;
- "Game over: N things are waiting".

Amber never notifies. A setting turns all notifications off.

## 8. Bridge changes the app needs (proposed; `bridge/bridge.js` isn't owned by this spec)

1. ~~Heartbeat and reconnect to the relay.~~ Done 2026-10-20.
2. **`GET /health`**: cheap, no `docker` call, so it can be polled every 5 s:
   ```json
   { "bridge": "3e533e72", "uptimeS": 8040, "phase": "running", "turn": 6, "room": "tts-commander",
     "seats": [{ "color": "White", "ai": false, "relay": "up" }, { "color": "Red", "ai": true, "relay": "lost" }],
     "table": { "stamp": "f9208197", "lastHeardMs": 2100 }, "resumed": false }
   ```
   `phase`: `none` (no game object), `setup` (game set up, not started), `running`, `over`. `relay`: `up`, `lost`
   (reconnecting), `closed`. `lastHeardMs`: time since the last message from the table.
3. **`POST /shutdown`**: closes every seat as the `SIGINT` handler does (`LeaveRoom`, close), then exits 0. Called only
   after the restart loop is stopped, or the loop starts it again.
4. Tests for both in `tests/test_bridge_debug.js`.

Until 2 exists, the app uses `/stats` (alive), `/state` (`started`), `/versions` (`now.table`) and `/log`.

Other proposals outside this spec:
- `engine/build-images.sh`: the source label (§3.3).
- `tools/start-bridge.ps1`: check in `tools/bridge-loop.cmd` instead of writing it each time, so the app can run it
  directly with `cmd` and no PowerShell hop (§9, antivirus).
- `tools/stop-bridge.ps1`: match `bridge.js` as a whole file name, as §3.6 does. Today `*bridge.js*` also kills
  `node echo-bridge.js` and any `*-bridge.js` test fake.
- `Start MTG.bat`: its last hint still says to load "MTG 4 player table - ENGINE MODE", a save that was deleted; it
  should say **Mock MTGA 4 player**.
- `/health` and `/shutdown` reach the live bridge only through a deploy between games, like any bridge change.

## 9. Technology

**Superseded 2026-11-06: the app must run on Windows, Mac and Linux (see §15, "Decided"), so the WinForms
recommendation below no longer stands; Tauri v2 is the proposed choice.** Kept for the record:

**Recommendation (2026-11-05): a C# WinForms tray app on .NET Framework 4.8, compiled with the `csc.exe` that ships with Windows.**

| Option | Size | Build needs | Good | Bad |
|---|---|---|---|---|
| **C# WinForms, `csc.exe`** (recommended) | ~150–300 KB exe | nothing: `C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` is on every Windows 10/11 (present here: compiler 4.8.9221.0, .NET Framework 4.8.1) | real tray icon, notifications, `ClientWebSocket`, event log reader, WMI, P/Invoke for ports and memory; starts in under 1 s; one file | C# 5 at most (`/langversion` takes only ISO-1, ISO-2, 3, 4, 5): no `$"..."`, no `?.`, no `=>` members, no `nameof`, no `out var`, no tuples, no `catch when`, no auto-property initialisers; use `string.Format`. WinForms looks plain |
| C# on .NET 8 | ~150 KB plus runtime, or ~60 MB self-contained | the .NET SDK, which this PC doesn't have (only runtimes 6.0 and 8.0) | modern C# | an SDK install; the runtime must be on each host or bundled |
| Node + a small UI | Node is already needed | none extra | same language as the bridge | no tray icon or notifications without npm packages (the repo has none on purpose); the UI would be a browser page; no event log or WMI without shelling out |
| PowerShell + WinForms | a .ps1 | none | quick to write | 2–4 s start; a console window flashes; `-ExecutionPolicy Bypass` and ps2exe wrappers are a common antivirus flag; hard to keep single-instance |
| Tauri v2 (the 2026-10-20 choice; Manabrew uses it) | ~10 MB | Rust toolchain, WebView2, Node for the UI | nice UI; the old spec's sidecar plan | the most build setup by far, for a window of 12 rows; Rust and web code for one dialog |

Why the recommendation:
- Builds on any Windows PC with nothing installed, from the repo, in a few seconds.
- Everything the lights need is in the framework: `System.Net.WebSockets.ClientWebSocket` (relay login),
  `HttpWebRequest` (bridge; it sends no `Origin` and the right `Host`, so the bridge's guard lets it in),
  `System.Diagnostics.Eventing.Reader` (GPU events), `System.Management` (process command lines),
  `System.Web.Script.Serialization` (JSON), P/Invoke `GetExtendedTcpTable` and `GlobalMemoryStatusEx`.
- Smallest CPU and memory cost next to TTS (§3.15).

Build command (`companion\build.cmd`):
```
%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /target:winexe /optimize+ ^
  /out:"MTG Companion.exe" /win32manifest:companion\app.manifest ^
  /r:System.Management.dll /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll ^
  /r:System.Drawing.dll /r:System.Core.dll companion\src\*.cs
```
`build.cmd` first writes `companion\src\BuildInfo.cs` with the build time and the sha8 of `companion\src\*.cs` (for
updates, below).

Checked 2026-11-05: a C# 5 test file using `ClientWebSocket`, `JavaScriptSerializer`, `EventLogReader` (nvlddmkm
query on the System log, unelevated), `ManagementObjectSearcher`, `HttpWebRequest` and `NotifyIcon` compiled with these
exact `/r:` options (`System.Net.WebSockets` is in `System.dll`, referenced by default) and ran, exit 0. Two settings
to keep: `HttpWebRequest.Proxy = null` (§3), and `JavaScriptSerializer.MaxJsonLength = int.MaxValue` (the default is
about 2 MB; the save is 1.1 MB and grows).

Source layout: `companion\src\` (one file per area: `App.cs`, `Probes.cs`, `Lights.cs`, `Start.cs`, `Fixes.cs`,
`Tray.cs`, `Config.cs`, `Native.cs`), `companion\tests\`, `companion\app.manifest`, `companion\build.cmd`. The exe goes
to the repo root, beside `Start MTG.bat`, and is not committed (`.gitignore`).

**No admin rights.** The manifest says `asInvoker`. Everything the app does works as a normal user: the Docker CLI
(works unelevated here today), `wsl --shutdown`, reading the System and Application logs (checked on this PC
2026-11-05), stopping the user's own processes. It can't stop an elevated process; it says so if that happens.

**Single instance.** A named mutex `Local\MtgTtsCompanion`. A second start signals the first (named event) to show
its window, then exits.

**Signing, SmartScreen, antivirus.**
- Built on the host's own PC from the repo, the exe has no "downloaded from the internet" mark, so SmartScreen
  doesn't ask.
- Downloaded from a GitHub release, an unsigned exe gets "Windows protected your PC" → More info → Run anyway, every
  new version. Signing removes that, but costs money every year; not worth it while only the user hosts. Revisit if
  others host (§15).
- Antivirus: a small unsigned exe that starts hidden processes and stops others can be flagged by heuristics. To keep
  that low: no obfuscation, no self-elevation, no downloads, a version resource and manifest, visible windows for long
  jobs (build, deploy), and `cmd` rather than hidden PowerShell once `bridge-loop.cmd` is checked in. Test against
  Defender and Malwarebytes (installed here 2026-10-28) in phase 5.

**Updates.**
- The app compares its `BuildInfo` sha8 with the current `companion\src\*.cs` at start and every 10 minutes. On a
  difference: amber row "Companion: a newer version is in the repo" → **Rebuild**.
- Rebuild runs `build.cmd` to `MTG Companion.new.exe`, renames the running exe to `.old` (Windows allows renaming a
  running exe), puts the new one in place, starts it, and exits. The bridge doesn't depend on the app (§6), but the
  compile takes CPU from TTS for a few seconds, so **Rebuild** waits until the game ends like the other fixes.
- Getting new source is `git pull`, done by the host. The app never pulls.

## 10. Files

**Reads**
- Repo: `stack\compose.yml`, `stack\deployed.json`, `stack\.env` (key only, never logged), `bridge\bridge.js`
  (exists check), `tmp\bridge-live.log`, `tmp\bridge-game.json` (age only), `engine\*.patch` and
  `engine\build-images.sh` (source stamp), `companion\src\*.cs` (update check).
- TTS: `Documents\My Games\Tabletop Simulator\Saves\TS_Save_1.json` (stamp), `Player.log` (loaded objects).
- Windows: `%USERPROFILE%\.wslconfig`, the System and Application event logs, the process list, TCP listeners,
  memory status, disk free space, the foreground-window event (§3.8), `HKCU\Software\Valve\Steam` `SteamPath`, the
  Docker Desktop uninstall key (§11).
- Docker: the engine API over its named pipe, read-only `GET`s only (§3.1). Every change goes through the CLI.

**Writes**
- `%LOCALAPPDATA%\MTG Companion\config.json` (settings, §11).
- `%LOCALAPPDATA%\MTG Companion\logs\companion-YYYY-MM-DD.log`: one line per light change, step, fix and button, with
  the probe's raw result for reds. Kept 14 days.
- `%LOCALAPPDATA%\MTG Companion\state.json`: last lights, restart counts tonight, waiting fixes, window position.
- `<repo>\tmp\bug-reports\bug-YYYYMMDD-HHMM.zip` from **Save a bug report**: `tmp\bridge-live.log` (last 5 MB),
  `bridge\tts-console.log`, `tmp\table-check.log`, `tmp\guess-log.log`, `tmp\tts-stream.jsonl` (last 20 MB),
  `stack\deployed.json`, `/versions` and `/state` output, `docker logs --tail 2000` of both containers, `Player.log`,
  the GPU and crash events of the last 24 hours, and the app's log. Saved locally only, never uploaded. It can hold
  Steam names and deck lists; the dialog says so.
- Only by a fix the host clicked: `%USERPROFILE%\.wslconfig` (backup first). Through the scripts it runs:
  `tmp\bridge-loop.cmd` and the bridge's logs (`start-bridge.ps1`), `stack\deployed.json` and the save
  (`tools/deploy.js`).
- Never: the save directly, `compose.yml`, anything under `manabrew\`, the registry.

## 11. Config and discovery

`%LOCALAPPDATA%\MTG Companion\config.json` (written with defaults on first run; a missing key means the default):

```json
{
  "version": 1,
  "repo": "C:\\Users\\you\\mtg-tts",
  "node": "node",
  "docker": "docker",
  "dockerDesktop": "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe",
  "ttsSave": "C:\\Users\\you\\Documents\\My Games\\Tabletop Simulator\\Saves\\TS_Save_1.json",
  "ttsSaveName": "Mock MTGA 4 player",
  "wsl": { "cores": 2, "memory": "8GB" },
  "ports": { "ttsIn": 39998, "ttsOut": 39999, "bridgeDebug": 48787, "relay": 9443 },
  "room": "tts-commander",
  "startOnLaunch": true,
  "openTtsOnStart": true,
  "stopDockerOnEnd": false,
  "notifications": true,
  "limits": { "objectsWarn": 78000, "omenAmberMB": 4096, "omenRedMB": 16384, "commitAmberPct": 85, "commitRedPct": 95 }
}
```

How it finds things (first that works; the result is written back to the config):
- **Repo:** the exe's own folder if it has `stack\compose.yml` and `bridge\bridge.js`; else `repo` from the config;
  else each parent folder of the exe; else a folder picker.
- **Node:** `node` from the config; else `where node`. Version from `node --version`, must be 22 or newer.
- **Docker CLI:** `docker` on `PATH`; else `C:\Program Files\Docker\Docker\resources\bin\docker.exe` (where `PATH`
  points here).
- **Docker engine pipe:** the endpoint of the current context (`docker context ls`: `desktop-linux` →
  `npipe:////./pipe/dockerDesktopLinuxEngine` here), read once at start; else `\\.\pipe\docker_engine`.
- **Docker Desktop:** `dockerDesktop` from the config; else the `InstallLocation` of the uninstall key
  `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Docker Desktop` (checked 2026-11-05: `InstallLocation`
  `C:\Program Files\Docker\Docker`, `DisplayVersion` 4.95.0; readable unelevated), + `Docker Desktop.exe`; else the
  default path above. `docker desktop start` (§6) is the other way to start it; the exe is what `Start MTG.bat` uses
  and is the tested one.
- **TTS:** `HKCU\Software\Valve\Steam` `SteamPath` (here `c:/program files (x86)/steam`), then
  `steamapps\libraryfolders.vdf` for the library holding app 286160. Launch is always `steam://rungameid/286160`;
  the exe path is only for "is TTS installed".
- **TTS saves:** `Documents` from `Environment.GetFolderPath(MyDocuments)` (follows OneDrive moves) +
  `My Games\Tabletop Simulator\Saves`.
- **Relay key:** `MANABREW_SERVER_KEY` in `stack\.env` if present (a server set up by `tools/setup-server.sh`), else
  `tts-local`.
- Container names `stack-relay-1` and `stack-forge-room-1` come from the compose project name `stack` (the folder).
  `bridge/versions.js` uses the same names.

## 12. Modes

| Mode | Forge + relay run on | Needs | Phase |
|---|---|---|---|
| **Home** (default) | the host's PC, in Docker Desktop | Docker Desktop (WSL2) | 1–5 |
| **Own server** | any server the user runs (`tools/setup-server.sh`) | relay address + key | 6: the Docker, WSL, Images and container lights go grey; the relay login probe points at the server |
| **Cloud Forge** | a DigitalOcean droplet made each night and deleted after, over Tailscale | DigitalOcean token, Tailscale | later (§14); paused |

The bridge always runs on the host's PC, because TTS only talks to localhost (SPEC §2).

## 13. Tests

**Unit, headless** (`companion\tests\`, built with the same `csc` into `CompanionTests.exe`, exit code 0 = pass):
- Each light is a pure function: probe results + "game on" + time → colour, sentence, fix. Fixture cases for every
  green, amber and red in §3, about 70 cases. Example: relay `healthy` + login closed after 19 ms → red, "games will
  fail at setup", fix "Restart relay and room".
- The game lock: every combination of bridge answer / `bridge-game.json` age / room status in §5, and every fix button
  against it. A locked fix must stay locked in all "game on" rows.
- Parsers: `docker inspect` output with one container missing, `.wslconfig` with and without `[wsl2]`, CRLF and LF,
  `Player.log` tail, the `engineStamp` line in a save, event-log XML.

**Against fakes, no real Docker or TTS:**
- A fake bridge (`tests/fake-companion-http.js`, Node, no dependencies; not named `*bridge.js`, or
  `stop-bridge.ps1` and the process match would take it for the real one) serving `/stats`, `/state`, `/versions`,
  `/log`, `/health` from switchable fixtures, on another port.
- A fake `docker.cmd` set as `docker` in a test config, printing fixture output and exit codes.
- The relay login against a test relay on 9444 (the existing recipe:
  `docker run --name mtg-test-relay --network stack_default -p 127.0.0.1:9444:9443 mtg-relay:exile`) with
  `ports.relay` 9444, so the real stack is never touched.
- The whole start sequence against the fakes: each step's failure stops the right steps, and **Try again from here**
  resumes.

**Live, on the host's PC, only with no game and with the user's OK for each:**

| Red to cause | How | Expected |
|---|---|---|
| Docker down | quit Docker Desktop | red, then **Start Docker Desktop** brings it back under 180 s |
| Relay container down | `docker stop stack-relay-1` | red, **Start the engine** fixes it |
| Stale relay forward | `wsl --shutdown` (only when the user says so) | Relay red "games will fail at setup"; the fix makes a debug game set up |
| Leftover room | start a debug game, kill the bridge, wait past 50 s | Forge room red; the fix brings `Lobby` |
| Bridge down | `tools\stop-bridge.ps1` | red, **Start the bridge** fixes it |
| Port taken | `node -e "require('net').createServer().listen(39998,'127.0.0.1')"` before the bridge starts | Ports red, names `node.exe` and its PID |
| Old table | load a backup save with an older stamp | Table red |
| WSL cores | a test config pointing at a copy of `.wslconfig` with `processors=3` | red; **Set 2 cores** edits the copy, keeps a backup |
| GPU reset | can't be caused; the fixture covers it, plus waiting for the next real one | red within 60 s |

- **Game-lock test:** start a debug game (`mtg debug`). Every locked button greys out, a second **Start game night**
  only checks, and the relay login probe stops. Repeat in setup (players seated, not started) and with the bridge
  hung (fake bridge that accepts and never answers): both must lock.
- **Crash test:** with a game on the headless table (`tests/lua/headless-tts.js`), kill the bridge's `node.exe`. The
  app shows "restarted itself", the game comes back, and the app does nothing else.
- **Own cost:** 30 minutes with everything green and a game on: the app's CPU time under 0.5% of one core, child
  processes counted.
- **Clean account:** a second Windows user with no Docker and no Node: each missing piece is red with a link.
- **Antivirus and SmartScreen:** Defender scan (`MpCmdRun -Scan -ScanType 3 -File`), Malwarebytes scan, and the exe
  downloaded through a browser from a test release to see the SmartScreen prompt.

## 14. Build plan

| Phase | Delivers | Hours | Ships |
|---|---|---|---|
| 0 | Bridge `/health` and `POST /shutdown` with tests (§8); build-images source label. Live only after a deploy between games | 2–3 | — |
| 1 | Skeleton: `build.cmd`, manifest, single instance, tray icon, config, discovery, logs, main window with rows fed by fake probes | 4–6 | — |
| 2 | All probes and lights (§3), the game lock (§5) with its three answers, the fake bridge and fake `docker` (§13), unit tests | 12–16 | **A: the Watcher.** Lights, readouts, notifications; no fix buttons, no start, nothing that changes anything. Zero risk, and it already catches the stale relay forward, GPU resets, OMEN, the wrong table and 78k objects |
| 3 | Start sequence (§4), stop and quit (§6), adopting a running bridge | 5–7 | **B: replaces `Start MTG.bat`** |
| 4 | Fix buttons with their confirmations, "waiting until the game ends" list | 5–7 | **C: one-click fixes** |
| 5 | Live tests (§13; each needs the user's OK and a time with no game), antivirus check, own-cost check | 4–6 | — |
| **MVP** | **Home mode, every light** | **32–45** | |
| 6 | Bug-report zip, upload readout, self-rebuild update, Own server mode, first-run checks (TTS installed, save present, Node and Docker links) | 6–8 | |
| 7 | Cloud Forge (the 2026-10-20 plan below), only if the user un-pauses hosting | 12–16 | |

Order: 0 can run beside 1. Each phase ends with the tests of what it added. The 2026-11-05 review raised the MVP from
26–36 h: phase 2 is the bulk (12 lights, about 70 cases, the pipe client, three-state game detection), and the fakes
move into it because the lock can't be tested without them. Live tests wait for windows with no game, which on this
project has been the slow part.

**Cloud Forge, kept from the 2026-10-20 version (phase 7):**
- Build once: a DigitalOcean droplet with cloud-init (Docker, Tailscale joined with an auth key tagged `tag:forge`,
  our compose file with the relay on the Tailscale address, images pinned by digest), a 2-turn headless smoke game
  (`rules-check`), a snapshot "golden", the droplet deleted.
- Each night: a droplet from the newest golden; wait for Tailscale and the health check; bridge started with
  `MTG_RELAY=ws://<droplet>:9443`; at the end, bridge stopped and droplet deleted.
- Safety nets: a droplet left past the auto-shutdown time (default 03:00) or idle 45 minutes is deleted, with a
  notification first; at start, any `mtg-forge-*` droplet still running is listed with **Delete now**.
- Secrets (DigitalOcean token, Tailscale key, relay key) in Windows Credential Manager (`CredWrite` / `CredRead`
  through P/Invoke), never in files or logs.
- A new engine image means rebuilding the golden snapshot.

Licence: the app is our code, under the repo's licence. It starts Manabrew's images and talks to the relay over its
published protocol, unmodified by the app (SPEC §9).

## 15. Open questions for the user

1. **Tauri → C# `csc`:** OK to drop the Tauri plan for a plain WinForms tray app? (§9)
2. **Start on double-click:** should opening the app start everything at once, or wait for **Start game night**?
   Proposed: start at once.
3. **Relay login probe:** every 30 s outside games, the app logs into the relay as `companion-xxxx` and asks for the
   room list. Fine? The relay source removes such a session when it closes, but it adds about 240 log lines an hour
   (§3.4). Phase 2 checks the relay log live for leftovers.
4. **Bridge restart mid-game:** the restart loop brings a crashed bridge back by itself, even past 80k objects, where
   the full redraw once came before a GPU reset. Keep it? (Without it the seats are lost after 65 s.)
5. **End game night:** stop Docker Desktop too, or leave it running? Proposed: leave it (setting).
6. **OMEN:** a button that stops it after asking each time: OK, or show the warning only?
7. **Who else will host?** If only you, the exe is built from the repo and needs no signing. If friends host, signing
   and a GitHub release come back into scope.
8. **Exe name and place:** `MTG Companion.exe` in the repo root, beside `Start MTG.bat`?
9. **Image source label:** OK to add it to `engine/build-images.sh` (§3.3)? Without it, "images out of date vs
   source" can only say "can't tell".

**Answers (the user, 2026-11-06):** 1–6, 8 and 9 as proposed (WinForms tray app; start on open; relay probe every
30 s; keep the bridge restart loop; leave Docker running, with a setting; OMEN button that asks each time;
`MTG Companion.exe` beside `Start MTG.bat`; add the image source label). **7: anyone may host, Mac included.** So
signing and a GitHub release are in scope, and this conflicts with 1: a WinForms app runs only on Windows, and
`Start MTG.bat`, the `.ps1` tools and the WSL setup are Windows-only too.

**Decided (the user, 2026-11-06, later): cross-platform, Windows, Mac and Linux.** This replaces answer 1: the
WinForms/`csc` plan in §9 is dropped. Proposed instead: Tauri v2 (the 2026-10-20 choice, which Manabrew already uses),
which gives a tray icon and notifications on all three. What has to change for it (not yet specced in detail):
- `Start MTG.bat` and the `.ps1` tools (`start-bridge.ps1`, `tts-shot.ps1`, the WSL steps) become Node scripts or
  get Mac/Linux twins; Node is already required.
- Docker: WSL2 is Windows-only. Mac runs Docker Desktop; Linux runs Docker Engine natively. The memory and
  `vmmemWSL` lights are Windows-only and need per-OS versions or are hidden.
- Engine images are built for x86-64. Apple-silicon Macs need arm64 builds of mtg-relay and mtg-forge-node (or run
  them slowly under emulation); to be measured.
- Windows-only lights are hidden elsewhere: OMEN button, GPU reset events (Windows event log), `GetExtendedTcpTable`.
- TTS itself runs on all three; its save and log folders differ per OS (Player.log path, Saves folder).
- Signing: Windows code signing, Apple notarization (needs an Apple developer account, the user's to create), and a
  Linux AppImage or .deb; the GitHub release carries all three.

**Decided (the user, 2026-11-06, later still): no app, no signing. Scripts plus a browser status page.** This
replaces the Tauri proposal above.
- `tools/start-mtg.js` (Node, already required) does what `Start MTG.bat` does today and stays running as the
  supervisor: it starts Docker and the stack, starts the bridge, keeps the bridge restart loop (answer 4), and runs
  the checks behind the lights (§3).
- Double-click wrappers only call it: `Start MTG.bat` (Windows), `Start MTG.command` (Mac, executable bit set in git),
  `start-mtg.sh` (Linux). Run from a `git clone` they carry no download flag, so nothing needs signing; a ZIP download
  needs one Unblock (Windows) or one `xattr -d com.apple.quarantine` / Open Anyway (Mac).
- The status page: `start-mtg.js` serves `http://127.0.0.1:<port>/` (bound to the loopback address only, so only the
  host's own PC can open it) and opens it in the default browser at start. The page shows the lights and refreshes
  every few seconds; its buttons (Restart relay and room, End game night, the OMEN button on Windows) post back to
  the same script, under the same game lock (§5). The launcher serves it, not the bridge, so the page can still say
  "bridge down" when the bridge is down. No npm packages: Node's built-in `http` module. Closing the browser tab
  changes nothing; closing the terminal window ends game night as the End button does.
- Lost against the app: tray icon and system notifications (the page can play a sound and change its tab title
  instead).

## 16. Review 2026-11-05

A second agent checked this spec against the repo and this PC, with read-only probes only. A game was on during the
review (`/state` `started: true`, turn 4), so nothing that talks to the relay or TTS was tried.

**Changed:**
- **Game lock (§5):** three answers: Game on, No game, Can't tell. A hung bridge, a timed-out probe or a failed WMI
  query is "Can't tell" and locks. Setup and game over count as a game (`/state` `seats` not `null`); before, `/state`
  `started: false` during setup would have unlocked "Restart relay and room" while players were seated.
- **Start the bridge (§3.6, §4 step 8):** `start-bridge.ps1` kills any running bridge first. It now runs only when the
  process list, the ports and `/stats` all say "none". Step 8 no longer decides on `/versions`, which takes 3–4 s.
- **Slow is not down (§3):** only "refused" means down. Measured: 35–41 s answers through PowerShell, 0.01–0.04 s
  with `curl`. `Proxy = null` on every request.
- **Engine swap (§3.3, §4 step 5):** `up -d --no-recreate`, so starting never quietly switches to an untested engine;
  the recreate fix says so.
- **Table safety (§5, §3.8):** the app never talks to 39999 and never sends Save & Play. Killing a hung TTS warns that
  unsaved table changes are lost. The 78k-object "relaunch" is a reminder, never a kill.
- **Docker probes over the engine pipe (§3.1):** no child processes; works unelevated (checked).
- **Image labels (§3.3):** `{{json .Config.Labels}}` fails on our images too; use `{{json .Config}}`.
- **Save stamp (§3.10):** the quotes are escaped in the file. `/log` times are UTC (§3.9).
- **New checks:** focus thieves (Razer) in §3.8, disk space in §3.12, a running `docker build` in §3.14.
- **Rebuild** waits for the game to end. Fake bridge renamed so `stop-bridge.ps1` can't kill it.
- **Plan (§14):** MVP 32–45 h, not 26–36. Ships in three steps; the first is a read-only Watcher after phase 2.

**Checked and true:** csc 4.8.9221.0, C# 5 at most, .NET Framework 4.8.1, no .NET SDK; a C# 5 test using every
framework part §9 names compiled and ran. Docker Desktop 4.95.0 at `C:\Program Files\Docker\Docker` (uninstall key);
`docker desktop start` / `stop` exist. Ports 39998 and 48787 held by the bridge's `node`, 39999 by TTS (table loaded),
9443 by `com.docker.backend`. Relay health check is in the image. `/health` and `/shutdown` don't exist yet (404).
`.wslconfig` says 2 cores and 8GB; Docker reports 2 CPUs. `docker inspect` with a missing container exits 1 and prints
the rest. The relay login messages match the bridge's.

**Still not checked:**
- whether TTS opens 39999 at the main menu (needs leaving the table);
- relay probe leftovers live (the source says a closed lobby session is removed at once);
- how Docker Desktop reacts to `wsl --shutdown` from the app, and `docker desktop stop` (only the help was read);
  `docker desktop status` hung over 2 minutes, so it is never used;
- how long a big table load keeps TTS "not responding";
- why PowerShell's requests to the bridge took 35–41 s;
- Razer focus stealing: no record of it in the repo or memory notes; the check is built from the lead's report.

## 17. Friend mode: built 2026-11-09 (branch `companion`)

The user hands the build to a friend: install Docker Desktop, unzip the package, double-click **MTG Companion.exe**.
This revives the §9 WinForms/`csc` plan for that one job; §15's cross-platform decision still stands for the general
host app.

**Source:** `companion\src\*.cs` (C# 5), `companion\app.manifest` (asInvoker), `companion\app.ico` (made by
`--write-icon`), `companion\build.cmd` → `companion\bin\MTG Companion.exe` (not committed). No NuGet.

**Where it runs from** (`Logic.DetectLayout`):
- **Friend mode:** `version.json` beside the exe. Package root = `MTG_HOME`; bundled `runtime\node\node.exe`; compose
  project `mtg-table`; logs in `logs\` (`companion.log`, `bridge.log`).
- **Home mode:** no `version.json`, but `bridge\bridge.js` + `Start MTG.bat` in the exe's folder or up to 4 above it
  (so `companion\bin\` works). Node on PATH, project `stack`, logs in `tmp\`, bridge via `tools\start-bridge.ps1`, no
  save step, `up -d --no-recreate`, and relay/room restarted only when the room isn't free or the login fails.

**Start sequence** (one light each; a red stops the steps after it; every red has one button):

| # | Light | Checks | Does (friend mode) |
|---|---|---|---|
| 1 | Docker | `GET /info` over the engine pipe (`dockerDesktopLinuxEngine`, then `docker_engine`); CLI `docker info` fallback every 30 s; `OSType` | not installed: red "Install Docker Desktop" + docker.com address as text, no download. Installed: starts `Docker Desktop.exe` (uninstall key, else default path), waits up to 180 s. Windows containers: red, says switch. The pipe refusing this account (`UnauthorizedAccessException`: not yet in `docker-users`) → red "sign out of Windows and back in", not 3 minutes of "starting" |
| 2 | Engine images | `GET /images/mtg-relay:exile/json`, `mtg-forge-node:exile` ids vs `version.json` `relay`/`node` | missing or different: `docker load -i images\mtg-images.tar(.gz)` with % from the docker process's read bytes; 90 min timeout. Ids after a load are remembered in `state.json` (Docker's containerd store reports other ids than `docker save`'s), so it doesn't load again each start, and written into the package's `stackdeployed.json` as `node`/`relay` (the package's own kept as `nodePackage`/`relayPackage`) when they are neither its ids nor its `nodeConfig`/`relayConfig` (the classic store's ids, which the packager records), so the bridge's `/versions` agrees. During a game: amber, loads after |
| 3 | Engine stack | containers by compose labels (project + service), relay `State.Health`; WebSocket login to `ws://127.0.0.1:9443` as `companion-xxxx` (the bridge's messages), `RoomList` → `tts-commander` `Lobby`; login skipped while locked | `docker compose -p mtg-table -f stack\compose.yml up -d`, `restart relay forge-room` (fresh room, as Start MTG.bat), then waits ≤120 s. Login failing 3 times on a healthy relay (the stale 9443 forward after `wsl --shutdown`) or a room stuck busy: one more restart by itself, then red **Restart relay and room**. "port is already allocated" → red naming the other engine |
| 4 | Table save | `%LOCALAPPDATA%\MTG Companion\state.json` (`saveFile`, `saveHash`), the Saves folder (`MyDocuments\My Games\Tabletop Simulator\Saves`) | `Logic.PlanSave`: our recorded file → update only when `version.json` `save` changed **and** the file still hashes to what we installed (`state.json` `saveHash`); a file the player saved over gets a new number instead (backup to `%LOCALAPPDATA%\MTG Companion\backup`, last 5); a byte-identical save → adopt; else a new `TS_Save_N.json` past every number in use (`.json` or `.png`), written with a move that refuses an existing file. Never touches a file it didn't install. Home mode: skipped |
| 5 | Bridge | `GET /versions` (15 s); TCP listeners on 39998/48787 with owner (`GetExtendedTcpTable`) and command line (WMI) | starts `MTG Companion.exe --bridge-loop` (hidden, own process: closing the app never touches a game). The loop runs `cmd /c node.exe … bridge\bridge.js >> logs\bridge.log 2>&1` with `MTG_HOME` and `MTG_LOG_DIR=logs`, and restarts it 3 s after any exit. Before starting it, a write test on `logs` and `bridge`: unwritable → one red "move the folder, e.g. C:GamesMTG-Table" (no restart loop). A port held by another program → red naming it (e.g. `Code.exe`, the VS Code/Atom TTS plugin); held by another `bridge.js` (e.g. the repo's) → red "another MTG bridge" |
| 6 | TTS | `Tabletop Simulator` process; `/versions` `now.table` (absent = the table hasn't spoken) vs `version.json` `table` | `steam://rungameid/286160` if not running. Amber with "In TTS: Create → Singleplayer (or Multiplayer) → Games → Save & Load → MTG Table (rules engine)" until the table speaks; green when the stamp matches; red "Old table loaded … load it again" when not |

After the sequence, a watcher re-reads every 5 s (15 s when the window is hidden): Docker, containers, the login every
60 s (never during a game), images every 5 minutes, `/versions` every 30 s, TTS.

**Game lock** (`Logic.DecideGame`): locked when `/state` has `started:true` **or** `seats` not null (setup, or a
finished game not yet `mtg reset`), when the bridge is refused but `bridge-game.json` (under `MTG_HOME\tmp` or
`\logs`) is under 60 s old, and when the bridge doesn't answer (can't tell). Locked: Restart engine, Restart relay and
room, Restart the bridge, Load the engine images, the save update. Never locked: Open TTS, Start Docker Desktop,
Start the bridge (only when nothing runs), Try again.

**Menu:** tray icon (worst light) with Open status, Open logs folder, Restart engine (locked during a game), Stop
everything (bridge loop + bridge, then `docker compose -p mtg-table down`; Docker Desktop keeps running), Quit (asks:
leave running, or stop first). Single instance (`Local\MtgTtsCompanion`; a second start shows the first window).
**Limit Docker's CPU use…** is an opt-in button: writes `processors=2`, `memory=8GB` into `[wsl2]` of
`%USERPROFILE%\.wslconfig` (backup first), never restarts WSL.

**Test modes:** `--selftest` (128 canned cases, exit code = failures), `--observe` (reads only; `--dump FILE` for text,
`--shot FILE` for a PNG of the window), `--home DIR`, `--saves DIR`, `--state DIR`, `--log FILE`, `--steps 4,5`,
`--bridge-url URL`, `--probe-login URL`, `--bridge-stop`.

**Not yet seen live:** a whole friend-mode start (needs a PC without the repo's stack: ports 9443/39998/48787 are the
repo's here); whether TTS lists a new `TS_Save_N.json` without an entry in `Saves\SaveFileInfos.json`; how long a
real ~1 GB `docker load` takes (a 36 MB tar took 94 s here with the stack running on 2 WSL cores).
