# Release fix plan, 2026-11-10

The fresh-install test of release v2026.11.10-0902 (unzipped package, companion double-clicked, dev stack and bridge
stopped) found three problems. Don't upload that release yet: it has bugs 1 and 2.

## What the test found

| # | Problem | What the friend would see | Status |
|---|---|---|---|
| 1 | The engine wait is 2 minutes, but a cold Forge room took 2 min 15 s to open (2 WSL cores) | A red Engine light and a Windows notification, though the engine was fine a second later | Fixed, built, self-tested; fresh install not re-run |
| 2 | After a stop, the start sequence never carries on by itself, and the "Start the bridge" button jumps to step 5, skipping step 4 (the table save) | "MTG Table (rules engine)" is missing from TTS's Save & Load list; the Table save row stays grey with no button | Fixed, built, self-tested; fresh install not re-run |
| 3 | Updates check GitHub Releases without a login, and the repo is private | The companion logs "Updates will work once the project is public."; the friend never gets updates | **Needs your decision** (below) |

Timeline from the companion log: compose up 09:05:03, relay and room restarted 09:05:30, wait ran out 09:07:44, room
open 09:07:45, Engine green 09:08:47, bridge started by the button 09:10:37, save step never ran.

## Fixes 1 and 2 (written, in companion/src)

- **Wait:** `Logic.StackWaitSeconds = 300` (5 minutes), used by both waits in `DoStack`; the red text
  (`Logic.StackTimedOut`) names the minutes.
- **Carry on by itself:** `RunSequence` records `stoppedAt`. Each watch tick, if that step's light has turned
  green, the sequence carries on from the next step (`Logic.ResumeAfterStop`). Not in observe mode, not after Stop.
- **Never skip a step:** a button for a later step starts at the stopped step, or at the step after it once that
  step is green (`Logic.StartFrom`). So "Start the bridge" after an engine stop runs save → bridge → TTS.
- **Self-tests:** a new `Sequence()` group with 8 checks covering both rules.
- **Review (/jr-programmer-suite, 2026-11-10):** a bug the first version still had (found by the verifier): a press
  that interrupted a run (Start the bridge pressed again during the 5-minute engine wait) cleared the stop, so the next
  run skipped steps 3-4 again. An interrupt now records its step in `stoppedAt` too. The worker's loop body is now
  `WorkOnce(watch)` (Loop passes `MonitorTick`), with `StartAt`, `ResumeIfGreen` and `StepGreen`, and a
  `SequenceWiring()` group drives a real Controller through it (worker thread not started, a fake watcher, `--steps 4`,
  where the save stops red because the temp package has no table): the stop, a later button re-running the red step,
  a press during a run, a press for an earlier step, the carry-on once the light is green, no second carry-on, a queued
  run kept. Stop everything also forgets the stop. `stopped` is now `everythingStopped`. Self-test group: 8 checks → 29.

## Decision needed: updates on a private repo (problem 3)

| Option | How | For | Against |
|---|---|---|---|
| A. Manual updates (recommended for now) | The friend downloads each new zip from the private release page and unzips it over the old folder; the companion already re-installs the save and loads new images | No secrets; works today | Not automatic |
| B. Friend's own token | **Already built** (found 2026-11-10 after this plan was first written): tray menu → **GitHub token…** (or `--set-token` from stdin) stores it with DPAPI in `%LOCALAPPDATA%\MTG Companion\github-token.bin` and sends it only to api.github.com (docs/companion-app-spec.md, update section). Left: a README section, the 404 line naming the token, and one real end-to-end check with a real token (you or the friend must enter it; I can't) | Automatic updates, repo stays private | A classic token with `repo` scope reads all of the friend's repos; whether a fine-grained token works for a collaborator on this repo has to be tried |
| C. Make the repo public | — | Updates work as built | Against the standing rule: the repo never goes public |

Option A needs only a README line, and the companion log text should say "download the new zip from the release page".

## Steps

| # | Step | Time |
|---|---|---|
| 1 | Build the companion and run `--selftest` (it was cut off mid-run) | 5 min |
| 2 | Review: a /jr-programmer-suite agent on the change, plus one Sonnet verifier that breaks each new rule and watches a self-test fail | 30–45 min |
| 3 | Local commit | 2 min |
| 4 | Fresh install again from scratch: `docker compose -p mtg-table down`, clear the companion's state, then start the rebuilt exe from the unzipped package. Check: no red at step 3 (or it carries on by itself), the save is installed, and the bridge starts. Also check whether TTS shows the new save without a restart (TTS was already open last time). | 20–30 min |
| 5 | In TTS: load "MTG Table (rules engine)", start a quick game vs one AI, play a land and a spell; check the status page | 15 min |
| 6 | Rebuild the signed release with the fixed companion (new tag, same version scheme) and re-check the zip's hashes | 15–20 min |
| 7 | Restore the dev setup: package stack down, dev stack up, dev bridge up, confirm /versions matches the deploy | 10 min |
| 8 | Update memory; hand off (upload the release, invite the friend, author message, back up the release key) | 10 min |

**Total: about 1 h 50 min to 2 h 20 min.** Option B would add 3–5 h before step 6.

## Result, 2026-11-10 afternoon

- Deployed first (bridge 6e0ff442, table 8de89da5, save c7d4a074): the companion fix, Sen glow, lands in the mana box,
  the named attack refusal.
- **Release v2026.11.10-1418** in `dist/release-v2026.11.10-1418/`, signed, every part included ("no previous
  release"). v2026.11.10-0902 and a first 1417 build that reused 0902's images and runtime were moved to
  `dist/_not-for-upload/`: never upload them.
- **Fresh install** from `dist/MTG-Table-2026-11-10-6e0ff442.zip` (companion state moved aside, dev stack and bridge
  stopped, TTS closed): all 6 steps ran by themselves in 25 s (Docker, images, engine 15 s, save installed as
  TS_Save_2 "MTG Table (rules engine)", bridge 6e0ff442, TTS). The save showed in TTS's list without a restart. The
  engine was warm; the 5-minute cold wait was not exercised again.
- **Real game** on that install, White on rebuilt_niv vs one AI: kept a hand, played a Mountain by drop (it lay at
  depth 7.04, inside the mana box), then `crawl-check` (Crawlspace for AI 1, three creatures for White): "All attack"
  was refused and the table said "That attack isn't legal. Crawlspace (AI 1): no more than 2 creatures can attack AI
  1 each combat. You chose 3.", also in the corner hint of the re-asked question. Conceded: "Game over: White
  conceded. AI 1 wins." No bridge errors from the game.
- Dev setup restored afterwards; /versions in step.
- Left for the user: create the release v2026.11.10-1418 on Vibecoding-mods/Table-Top-Simulator-MTG-Rules-Enforcer and attach
  the 8 files in its folder; invite the friend; the author message (docs/publishing-checklist.md); back up the
  release key. Updates (option B) need a token the friend enters in the companion's tray menu.

## Not in scope

- The three findings from the real-table check (Sen glow under GAME OVER, Mindslaver auto-pass, the passive AI
  casting Counterspell): queued in docs/next-features-2026-11-09.md.
- The cloud plan (docs/cloud-aws-spec.md): not scheduled.
