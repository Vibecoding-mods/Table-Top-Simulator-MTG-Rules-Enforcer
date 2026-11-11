# Publishing checklist (GitHub, open source)

Status 2026-11-05: **prepared, not public.** The git repository exists (first commit 2026-10-30) and is pushed to a
**private** GitHub repository; it has not been made public.
Repository: `Vibecoding-mods/Table-Top-Simulator-Mock-MTGA` (the name is the owner's decision).

## Done

- [x] README.md (what it is, how it works, quick start, commands, tests, repo map, credits and the Wizards Fan
  Content Policy notice)
- [x] THIRD-PARTY-NOTICES.md (Manabrew, Forge, the Workshop table, Scryfall, Wizards, test-only tools)
- [x] `.gitignore`:
  - generated files: `tmp/`, caches, logs, mutants;
  - our private working notes: `research_notes/`;
  - third-party content kept out: the `manabrew/` clone, `table-scripts/` (the group table's scripts), `assets/` (the
    skybox picture), `tools/presentmon/` (an .exe).
- [x] `.gitattributes`: LF line endings (mixed CRLF/LF broke patch scripts once); `.ps1`/`.cmd` stay CRLF.
- [x] Our decks moved out of the Manabrew clone into `decks/` (`bridge/presets.js` reads `decks/` first, then Manabrew's).
- [x] Engine: `stack/compose.yml` runs our own builds; `engine/` has the patches against pinned upstream commits and
  `engine/build-images.sh`, proven by a build from a clean clone. This is what the AGPL and GPL require (`engine/README.md`).
- [x] Privacy scan of everything that would be published:
  - no API keys, tokens, passwords or email addresses;
  - local paths (`C:\Users\<name>\...`) replaced with repo-relative paths in all docs and reports;
  - the table author's Steam ID redacted in our docs.
    It remains in `tools/make-engine-copy.js`, as the pattern that *removes* that permission from the table; needed for
    the patch to work.
- [x] `bridge/state-delta.js` rewritten from Manabrew's CC-BY protocol specification (no AGPL code left), with its own test (`tests/test_state_delta.js`, 26 checks).

## Decisions that are yours

1. ~~**Licence for our code.**~~ **Decided 2026-10-20: public domain (the Unlicense, `LICENSE`)**: "do whatever you want with it". `bridge/state-delta.js` was rewritten from Manabrew's CC-BY protocol specification first (checked against the old version on 5,000 random patches and against the live engine: 124 patches, 0 fingerprint mismatches), so no AGPL code is left.
2. **The table's author.**
   - The repo contains no table scripts, only our patcher, which edits each user's own Workshop download.
   - Publishing a ready-made ENGINE MODE table **on the Steam Workshop** would redistribute their work: ask them first.
   - Asking is good manners even for the GitHub repo, since the docs describe their scripts in detail (`docs/table-functions-*.md`, `table-review/`).
3. **Repository name and owner** (personal account or an organisation).
4. **Reports and research:**
   - `reports/` (4 research reports) is included;
   - `research_notes/` (raw notes) is excluded.
   - Keep or drop the reports?

## Before the first public push

- [x] Licence: `LICENSE` (the Unlicense).
- [x] The table golden test works for others: its exported decks ship in `tests/golden/fixtures/table-export`; it still
  needs the Workshop table (`MTG_TABLE_JSON` points at a copy).
- [ ] `bridge/forge-cards.json` (1.4 MB, card names from Forge): keep in the repo (simplest), or build it on first run.
- [x] The tested Manabrew and Forge commits are pinned in `engine/build-images.sh`.
- [x] `git init`, first commit, push to a **private** GitHub repository (Vibecoding-mods/Table-Top-Simulator-Mock-MTGA).
- [ ] Read it through on GitHub once, then make it public (after messaging the table's author, below).
- [x] Refresh `engine/manabrew.patch` from the running engine (done 2026-11-06: 31 files, applies to upstream
  `fd16e2f` and reproduces every changed file; `engine/make-patches.sh` now diffs against the clean tree's commit, so
  our local manabrew commit is included). Redo it after any later harness change.
- [ ] Optional: GitHub Actions running the bridge golden + claims tests on every push (no Docker or TTS needed).

## Not in scope of the first release

- The Steam Workshop upload (needs the table author's OK, see decision 2).
- The companion app (docs/companion-app-spec.md): a later release.

## Invite-only sharing (asked 2026-11-09)

GitHub has no "unlisted" repositories. A private repository is seen only by people its owner invites, so the repo stays
**private**, and friends are added one at a time.

- **Owner's steps on github.com** (account actions, done by the owner):
  1. Settings → Collaborators → Add people, with the friend's GitHub username. The friend accepts the email invite.
  2. Releases → Draft a new release, with a tag such as `friend-2026-11-09`. Attach the zip from
     `node tools/make-friend-package.js`, then publish. Release assets can be up to 2 GB; the zip is about 320 MB, too
     big for git itself (100 MB per file).
- **For someone without a GitHub account:** upload the same zip to a file host with an "anyone with the link" setting
  (Google Drive, OneDrive, Dropbox). That is the only real link-only option.
- The friend zip contains a **patched copy of the Workshop table**. That redistributes the author's work, even when
  shared privately, so message them first (draft below).
- Done for it: the privacy scan was re-run on 2026-11-09.
  - Commit authors are the GitHub noreply address.
  - No keys or email addresses are present.
  - The local username has been removed from docs/companion-app-spec.md.
  - Two old commits (8d75957, 0ee9d91) still contain local Windows paths in their history. That's harmless for an
    invite-only repo; rewrite them only if it ever goes public.

Draft message to the table's author, for a Workshop comment on 2296042369 or their Steam profile:

> Hey! Thanks for your MTG 4 player table. I've built a project on top of it: Commander with the Forge rules engine
> enforcing the rules (triggers, the stack, priority, combat and AI opponents). It patches a copy of your table to add
> the engine scripts, and removes the hard-coded "promote me" permission and the Smart mulligan button.
>
> It's a work in progress. I'm sharing it with a few friends now, including a ready-to-run download with the patched
> table, and I'll make the GitHub repo public soon. You're credited as the table's author with a link to your Workshop
> page.

## Before making the repository public

- [ ] **Message the table's author first** (Workshop 2296042369: a Workshop comment or their Steam profile). Draft:

  > Hi! I've really enjoyed your MTG 4 player table. I've been building an open-source project that runs Commander on it with
  > the Forge rules engine enforcing the rules. It doesn't include or redistribute your table: people need their own copy from
  > the Workshop, and a small script patches that copy on their PC. The patcher does change some things for engine play,
  > including removing the hard-coded "promote me" permission and the Smart mulligan button, and the docs describe how your
  > scripts work. I'm planning to make the GitHub repository public and wanted to tell you first, with credit to you and a
  > link to your table. Are you okay with that, or is there anything you'd like changed?

- [ ] Read the repository through once on GitHub, then change it to public.

## The itch.io page (decided 2026-11-11: GitHub + itch.io; the Steam Workshop optional)

- [ ] The repository is public before (or as) the page goes up: the engine in `images.tar` is GPL/AGPL, so its source
  must be reachable. The release also carries `LICENSES/SOURCE.txt` and the patches.
- [ ] Pricing: free, no payments (the Fan Content Policy forbids selling).
- [ ] The page links the GitHub repository and repeats the Wizards notice from README.md "Credits and legal".
- [ ] The page says it was **made with Claude Code** (the AI tool that wrote it), as README.md does. itch.io asks for
  honest metadata; Nexus Mods, if ever used, requires a generative-AI disclosure.
- [ ] Every file is under itch's 1 GB per-file limit (release 1418: largest 336 MB).
