# Report: owner-decisions fixes (two Windows break-it survivors)

Cloud session, 2026-11-17, branch `cloud/owner-decisions-fixes`, from `origin/cloud/owner-decisions-1117` (`e819680`).

On Windows (csc), `node tools/mutate-companion-own-server.js` left two mutations that survived. Under mono both were
caught, which is why the earlier run here missed them. Both now have checks that fail by the mutations' own names.
The mutations are unchanged.

## 1. "DPAPI for the machine, not the account"

**Why it survived on Windows.**

- The DPAPI blob itself records its scope, and `ProtectedData.Unprotect` opens a machine blob with either scope. So a
  round trip passes whichever scope `Protect` used.
- Mono's own implementation keeps machine keys elsewhere, so there the round trip broke and the mutation was caught.

**The check.** `KeyVault.MachineScoped(blob)` reads the scope from a Windows blob:

- the blob's version;
- the DPAPI provider's GUID (`df9d8cd0-1501-11d1-8c7a-00c04fc297eb`) at byte 4;
- the master key's version and GUID;
- then `dwFlags` at byte 40, where `CRYPTPROTECT_LOCAL_MACHINE` is 0x4.

It returns null for a blob that isn't in that format (mono's).

The existing self-test check, "key: DPAPI (ProtectedData, CurrentUser) round trip, the blob never the key" (the name
the mutation needs), now also requires that the blob isn't machine-scoped. On Windows the mutation therefore fails
that check by name. Under mono the round trip still catches it, as before.

A new self-test check, "key: the scope reader: …", runs the reader on made-up Windows-shaped blobs: flags 0 is an
account's, 0x4 and 0x20000004 are a machine's, and other formats or short blobs give null.

**Not run here:** Windows DPAPI itself.

- The blob layout is the documented `DPAPI_BLOB` header (version, provider GUID, master-key version and GUID,
  `dwFlags`). It is checked here only on made-up blobs.
- If a real Windows blob doesn't match it, the reader returns null and the check falls back to the round trip alone.
  The Windows break-it would then show the mutation surviving again, not a false failure.

## 2. "the table's build not passed to the light"

**Why it survived on Windows.**

- The engine-build warning is decided in two places, each reading `stack/deployed.json`'s `engineBuild`: the start
  sequence's `DoServer`, and the watcher's `MonitorServer`. The mutation drops it from the watcher's.
- `--dump` writes the lights after the first pass, which is the start sequence. Under mono a watcher tick usually ran
  before the dump, so the check caught the mutation. On a fast Windows machine it didn't, so the watcher's light was
  never seen.

**The fix.** `--watch-once` (with `--dump`) runs one watcher pass on the worker after the first pass, then writes the
dump (`Controller.WatchOnce`).

`tests/test_companion_own_server.js` now runs the engine-build cases both ways, through the real companion against a
fake relay whose room says `engine_build`, with `stack/deployed.json` in the package (no test-only argument):

- as the start sequence decides (plain `--dump`);
- and as the watcher decides (`--watch-once`).

Each way, the checks keep the names the mutation needs:

- another build than the table's must be amber, with "Your server runs engine engine1120, but this table was deployed
  with engine engine1121" and Try again;
- the same build must be green.

**Results.**

- With the mutation built in, the watcher run fails "another engine build than the table's: amber, both named, Try
  again" by name. Under mono the plain run fails too, because the watcher races into it.
- `tests/test_companion_own_server.js`: 22 of 22 (20 before; 2 more are the watcher runs).
- `--selftest --section own-server`: 68 of 68.
- `node tools/mutate-companion-own-server.js "DPAPI for the machine|table's build not passed"`: 2 of 2 caught here
  (mono).

## Files

- `companion/src/KeyVault.cs`: `MachineScoped`.
- `companion/src/SelfTestServer.cs`: the round trip's scope part, and the scope reader's check.
- `companion/src/Controller.cs`: `WatchOnce`.
- `companion/src/Program.cs`: `--watch-once`.
- `tests/test_companion_own_server.js`: both ways.

## Not run here

- The Windows csc build and the Windows break-it. They are to be rerun on Windows: `node
  tools/mutate-companion-own-server.js`.
- The save-based gates, which no change here touches.
