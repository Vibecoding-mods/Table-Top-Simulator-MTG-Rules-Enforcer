# Publishing checklist (GitHub, open source)

Status 2026-10-30: **prepared, not published.** Nothing has been pushed anywhere and no git repository exists yet.
Repository: `Vibecoding-mods/Table-Top-Simulator-Mock-MTGA-Magic-The-Gathering-Arena-` (the name is the owner's decision).

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
- [ ] `git init`, first commit, push to a **private** GitHub repository, read it through on GitHub once, then make it public.
- [ ] Optional: GitHub Actions running the bridge golden + claims tests on every push (no Docker or TTS needed).

## Not in scope of the first release

- The Steam Workshop upload (needs the table author's OK, see decision 2).
- The companion app (docs/companion-app-spec.md): a later release.
