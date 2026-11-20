# MTG Companion: troubleshooting and FAQ

For hosts: the person whose PC runs the engine. Friends who only join your TTS game need nothing but Tabletop
Simulator. The companion's status page has a short version of this page under **Help: common problems**.

**First rule:** every red light says what is wrong and has one button that fixes it. Press that button first. Buttons
that restart things are locked while a game is on, so a fix never ends a game by surprise.

## Getting it running

**I downloaded the project and the companion says "No engine images".**
You downloaded the source code (GitHub's green **Code** button, or "Source code" under a release). That has no
engine. Go to the [Releases page](https://github.com/Vibecoding-mods/Table-Top-Simulator-MTG-Rules-Enforcer/releases)
and download **MTG-Table-…zip** (Windows) or **MTG-Table-linux-x64-…tar.gz** (Linux / Steam Deck) under Assets.

**Windows says "Windows protected your PC" or won't start MTG Companion.**
Before unzipping: right-click the .zip, Properties, tick **Unblock**, OK, then unzip again. Or click **More info**,
then **Run anyway**. README-FRIEND.txt in the zip covers Smart App Control.

**I started the new MTG Companion, but the old window came back.**
An older copy from another folder was still running. Since v2026.11.19-2120 the new one asks: **Yes** closes the old
one (and its bridge). With an older version, right-click the companion's tray icon (bottom right of the taskbar),
**Quit**, then start the new one.

**Docker Desktop won't start, or the Docker light stays red.**
- Start Docker Desktop and wait until it says it is running. Accept its terms and its WSL update if it asks.
- "Not allowed to use Docker": sign out of Windows and back in (the install added you to docker-users).
- "Virtualization is off": turn on SVM (AMD) or Intel VT-x in the BIOS. Task Manager, Performance, CPU says
  "Virtualization: Enabled" when it is on.
- Still nothing: in an admin terminal run `wsl --install --no-distribution`, restart the PC.
- Step by step: [docker-setup.md](docker-setup.md).

**The first Start engine takes a long time.**
Normal: the first start loads the engine into Docker (a few minutes). Later starts take seconds.

## The lights

**Bridge: "Running, but it isn't the deployed bridge" (or "this package's bridge").**
The bridge that runs is an older one. Press **Restart the bridge** between games. If it keeps saying so after a
restart, the companion itself is old: quit it from the tray and start it again. (Companions before 2026-11-20 read
the deployed version only once, at start, so after a deploy they called the new bridge wrong.)

**Bridge: "The bridge didn't start".**
Press **Start the bridge**. If it names port 39998, close the TTS extension of VS Code or Atom (it uses the same
port). If it says the folder can't be written to, move the package out of OneDrive, Documents or Program Files.

**Table save is grey and says "Not checked" on my own PC (home mode).**
Nothing is wrong. Running from the project's source (home mode), `node tools/deploy.js` installs the table save, so
the companion leaves it alone. In the release package it installs and checks the save itself.

**Table save is red: "Subscribe to the table on the Steam Workshop".**
Subscribe to the [4-player table](https://steamcommunity.com/sharedfiles/filedetails/?id=2296042369), start TTS once
so Steam downloads it, then press **Try again**. "A patch didn't apply" means the table's author changed it: update
the package.

**Engine stack is red after the PC slept or Docker restarted.**
Press **Restart relay and room**. If a game was being set up, type `mtg reset` in TTS chat first.

**TTS is amber: "Load the table".**
In TTS: Create, Multiplayer (Singleplayer to play alone), Games, Save & Load, **MTG Table (rules engine)**. On the
project's own PC (home mode) the save is called **Mock MTGA 4 player**.

**Engine images is amber: "Present, but not the images in stack\deployed.json".**
Docker has engine images, but not the ones this table was deployed with. A release package loads its own; in home mode
`node tools/deploy.js` (or `engine/build-images.sh`) puts the right ones in. Games may still work, but deploy before
relying on it.

## In the game

**A card shows as unknown, or my deck counts 99 cards.**
Update to the newest release. The card list now rebuilds itself whenever the engine changes.

**The engine gets slow late in a game with a big board.**
Forge re-checks every permanent each time you get priority, so a board with dozens of tokens and Treasures takes much longer
per click (on 2 cores: about 30 ms each at the start of a game, about 370 ms and up to 2.5 s with 60 tokens out). Give Docker more
cores: **Docker: 3 cores** or **Docker: 4 cores** under Actions. It counts after WSL restarts (restart the PC, or between games
quit Docker Desktop and run `wsl --shutdown`). Fewer cores leave TTS more to itself: go back to 2 if TTS stutters or crashes.

**A GIF frame is a white square (Steam Deck, Mac or Linux).**
Type `mtg gifs still` in TTS chat: that player sees still pictures instead of the video.

**Something went wrong mid-setup.**
`mtg reset` in TTS chat starts the setup over.

## Updates

**How do I update?**
Open the companion's status page (tray icon, **Open status**). When a new release is out it shows
**Update available** with **Update now** and **Later**. **Check for updates** checks right away (it also checks by
itself at start, at most every 6 hours). It never installs during a game: it waits until 2 minutes after the game.
**Revert to v…** goes back to the version before the last update. The project's own PC (home mode) updates with git,
not here.

## Still stuck

Press **Open logs folder** in the companion and send the files there (companion.log, bridge.log) to whoever gave you
the package, or open an issue on GitHub. Close the companion and start it again first: many problems end there.
