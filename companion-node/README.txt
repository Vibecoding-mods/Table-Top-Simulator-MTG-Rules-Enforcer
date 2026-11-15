MTG Companion for Linux (Steam Deck) and macOS - this folder IS its source
=========================================================================

These .js files are the program itself, exactly as written. Nothing is compiled, bundled, minified, packed into a
single executable, base64-encoded or obfuscated. start.sh (Linux) or "MTG Companion.command" (Mac) is a few lines
of shell that run

    runtime/node/bin/node companion/companion.js

where runtime/node/bin/node is the official Node.js binary from nodejs.org, unchanged (version.json "nodeArchive"
names the archive it came from and that archive's sha256, which you can compare with nodejs.org's SHASUMS256.txt).
The companion uses only Node's built-in modules: there is no node_modules folder and nothing is downloaded.

What each file does:
  companion.js    the command line: finds the package, starts the status page and checks the six steps. It
                  starts nothing itself: the page's Start engine button does (or --start, at launch)
  logic.js        every decision (the lights, the messages, the game lock, never overwriting your TTS saves,
                  the update check rules); no input or output of its own
  platform.js     Linux and macOS facts (where TTS keeps its saves, the container commands, reading processes)
  probes.js       the input and output: files, processes, ports, HTTP, the engine's login check
  engine.js       Docker or Podman: load the images, run, start, stop and remove the two engine containers
  controller.js   the launch check, the start sequence (6 steps) and the watcher that keeps the lights current
  web.js          the status page server, on 127.0.0.1 only, with a per-run token; page.html is its page
  bridge-loop.js  runs the bridge (bridge/bridge.js, also plain JavaScript) and restarts it if it stops
  update.js       checks GitHub for a newer release (signature-checked with release-keys.txt, the PUBLIC key only).
                  It only tells you; it never downloads or installs anything
  shim/docker     a short shell script: the bridge's "docker" calls go to Podman (or Docker) through it
  mods.js         loads logic.js and platform.js (only breakit.js, running selftest.js, can swap in a broken copy)
  selftest.js     the checks: runtime/node/bin/node companion/companion.js --selftest
  breakit.js      proves the checks work: breaks one rule at a time in a copy and expects a red check

It listens only on 127.0.0.1 (this computer), runs only these programs: docker or podman, steam or xdg-open (Linux),
open, ps and lsof (Mac), sh (the shim), and the bundled node. Its log is logs/companion.log.
