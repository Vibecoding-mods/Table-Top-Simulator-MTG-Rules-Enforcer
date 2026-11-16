# Report: the companion's own-server mode

Cloud session, 2026-11-16, branch `cloud/companion-server` (from `origin/main` ff46db1). This covers the Linux/macOS
companion (`companion-node`). The Windows app (`companion/src`, C#) is unchanged; see the questions below.

## What it does

A host can point the companion at an engine (relay and Forge room) on their own server instead of this computer.

- **Config:** `server.json` in the package folder (in the repo: its root), for example
  `{ "host": "mtg.example.org", "port": 9443, "key": "...", "secure": false }`. Only `host` is needed.
  - `--server HOST[:PORT]` sets it for one run (`start.sh` passes its arguments through).
  - The key comes from `server.json`'s `key`, else `MTG_SERVER_KEY`, else the package's own key.
  - `"secure": true` connects with `wss://`.
  - The file is refused, with the reason, when the host has a scheme, a space or a bad name, when the port isn't 1 to
    65535, when a setting is misspelt (named in the message), when the key is empty, or when the JSON is invalid.
- **Lights:**
  - **Container engine** and **Engine images** say "Not needed here: the engine runs on your server (host:port)".
  - **Engine stack** is the connection check: a TCP connection first (it says why a server can't be reached), then
    the relay login and the room list.
  - **Bridge** and **TTS** are unchanged.
  - Nothing is started or stopped on the server. **Stop everything** and `stop.sh` stop the bridge only.
- **Connection errors** (each red, with **Try again**):
  - "refused the connection: nothing listens on port N there";
  - "didn't answer" (the firewall and the address);
  - "isn't known" (a name that doesn't resolve);
  - "refused the key" (put the server's key in `server.json`);
  - "its Forge room isn't open";
  - "busy with an earlier game";
  - a `server.json` problem.
- **Bridge:** started with `MTG_RELAY` (`ws[s]://host:port`) and `MTG_KEY`, which `bridge.js` already reads.
- **The key:** never printed, logged or written to the observe dump; a test checks this.
- **Docs:** HOW-TO-PLAY.md has the new section "Optional: Own server (the engine on another computer)": setting up with
  `tools/setup-server.sh`, `server.json`, `--server`, what each red light means, and keeping the key private.
  `companion-node/README.txt` has a paragraph on it.

Files:

- `companion-node/logic.js`: `serverSetting`, `parseServer`, `serverSpec`, `serverUrl`, `decideServer`,
  `serverNotNeeded`, and `layout.serverFile`.
- `companion-node/probes.js`: `tcpReach`.
- `companion-node/controller.js`: `doServer`, `monitorServer`, `serverEnv`; `login` uses the server; steps 1-2 and
  Stop everything skip the container engine.
- `companion-node/companion.js`: reads `server.json` and `--server`; says the mode at start; `--stop` leaves the
  server alone.
- `selftest.js`, `breakit.js`, `README.txt`, `HOW-TO-PLAY.md`, and the new `tests/test_companion_server.js`.

## Tests

- **`node companion-node/companion.js --selftest`:** 447 passed, 0 failed (32 new).
  - Section "own server (server.json, --server)": parsing, precedence, every refusal, every light.
  - Section "own server wiring": no container engine is asked, the login goes to the server with its key, the bridge
    gets `MTG_RELAY` and `MTG_KEY`, Stop everything leaves the server alone, and the watcher asks no container engine.
- **`node tests/test_companion_server.js`:** 17 passed, 0 failed.
  - It runs a fake relay (a WebSocket server on a spare port; `no-live-ports` keeps 9443 and the other live ports
    out) and checks, with the real connection check: open room (green), the key sent, wrong key, no room, busy room,
    silent server, nothing on the port, an unknown name, and the TCP check.
  - It runs the real companion (`--observe --dump`) four times, with and without `server.json`: the message at
    start, the lights, `--server` overriding the file, a `server.json` problem, no key in the output, dump or log, and
    no `server.json` meaning this computer's engine again.
- **Unchanged:**
  - `test_friend_package_unix` 81 of 81, `test_companion_page` 242 of 242.
  - `test_friend_package` (1 check: the Workshop patcher case) and `test_companion_update` (`spawnSync cmd`, a Windows
    command) fail the same way on the unchanged code.

## Break-its

- **`node companion-node/breakit.js`:** 41 of 41 turn red; 11 are new, for `logic.js`. Each one fails its check by
  name:
  - the default port;
  - a `ws://` host accepted;
  - a misspelt setting ignored;
  - `MTG_SERVER_KEY` beating the file's key;
  - `--server`'s port dropped;
  - `secure` ignored;
  - the refused and refused-key messages made generic;
  - a busy room counted as ready;
  - steps 1-2 grey, so the engine never counts as up;
  - a `server.json` problem made green.

  The originals are compared by sha256.
- **`node tests/test_companion_server.js --breakit`:** 9 of 9 turn red. Each case edits `controller.js` or
  `companion.js` in place, runs this test or the self-test, and puts the file back, checked by sha256:
  - the login on another port;
  - the login with the package's key;
  - steps 1-2 running the container engine;
  - the bridge not told the relay and key;
  - Stop everything stopping containers;
  - the watcher asking the container engine;
  - `server.json` never read;
  - `--server` ignored;
  - a `server.json` problem not said at start.

  On the first runs three cases missed, all from test-side problems, now fixed:
  - one break's text no longer matched after an edit;
  - one check accepted a single row where two should match;
  - one check crashed instead of failing by name; it now catches the error.

  The "login on another port" case never points at 9443, so a break can't reach a real relay.

## Not tested

- No real server. The fake relay speaks the relay's login and room-list messages, but a real relay over the internet,
  TLS (`secure: true`) and Tailscale were not tried.
- The Windows app was not changed or tested.

## Questions for the user

1. **The Windows app.** Own-server mode is only in the Linux/macOS companion. Should `MTG Companion.exe` (C#,
   `companion/src`) get the same `server.json`?
2. **Where the key lives.** It is plain text in `server.json` (or `MTG_SERVER_KEY`). The Windows app's design talked
   about DPAPI for cloud keys. Is a plain file, which the docs tell the host to keep to themselves, enough here, or
   should it go in the OS keychain?
3. **`mtg reset` with a server.** The bridge's room restart (`bridge.js` `restartRoom`: `docker compose restart
   forge-room`) and `/versions` (`bridge/versions.js`: `docker inspect`) use this computer's Docker.
   - Against a server, the restart fails with "[MTG] Restart failed: ...". If a local stack exists, it restarts that
     one instead.
   - Should the bridge skip the restart (or say "restart the room on your server") when `MTG_RELAY` isn't local? That
     is a bridge change, so I didn't make it here.
4. **Version check.** With a server, the companion can't tell whether the server runs the engine images this package
   was built for. Is a mismatch the host's job, or should the bridge or relay report a version the companion compares?
5. **Setting it up.** It is file-based (and `--server`). Should the status page get a box to enter the host, port and
   key?
6. **TLS.** `tools/setup-server.sh` binds to Tailscale or the server itself and sets up no TLS. `secure: true` exists
   for a relay behind a TLS proxy. Should setup-server offer TLS, or should the docs recommend Tailscale only?
