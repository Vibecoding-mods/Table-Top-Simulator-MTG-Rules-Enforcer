# Report: the companion own-server break-it's two Windows survivors

Cloud session, 2026-11-17, branch `cloud/companion-survivors` from `origin/cloud/followups-3` (ce33124).
- **Base:** `origin/main` is still f4f614d, without followups-3, so the branch starts where the code the Windows run
  used is.
- **Build:** under mono (`mcs`, `xvfb-run`) as before. Windows' `csc` isn't here.
- **What changed:** test and self-test only, plus the tool. No change to the companion's own behaviour.
- No permission prompt is pending.

## 1. "the login made on this PC with a server": a real survivor, closed

**Why the named check passed on Windows.** The mutation turns `Controller.Login()`'s server branch off, so the login
takes the other branch: `ws://127.0.0.1:9443` with the package's own relay key.
- **On the owner's PC** a live relay listens on 9443. The mutant logs in there, sees the room open, and shows the same
  green text the check looks for: "Your server answers (127.0.0.1:<the fake relay's port>): room tts-commander is open".
  The text names the configured server, not where the login went. So the named check passed, and the neighbours
  failed instead:
  - "the key was sent to the server": the fake relay saw nothing;
  - "a wrong key": the live relay accepted the package key.
- **In the cloud** nothing listens on 9443, so the mutant's login failed and the named check failed too.
- **Reproduced here:** with a stand-in relay on 9443 that takes any key, the mutation **survived**, with exactly the
  Windows failures ("server answers: the key was sent to the server | a wrong key: red, refused the key, Try again:
  Your server answers (127.0.0.1:38707): room tts-commander is open (login 54 ms).").

**The fix (`tests/test_companion_own_server.js`):**
- "server answers: green, Your server, the room open" now also requires that the fake relay got a login during that
  run.
- "a wrong key: red, refused the key, Try again" requires that the fake relay got that wrong key.
- Both are stronger, not weaker: a companion that logs in anywhere else no longer passes them.
- With the stand-in on 9443 the mutation is now **caught by name**.

**Worth knowing:** on Windows this mutant, and any companion test with a bad server branch, logs in to the live relay
with the package key: one `companion-xxxx` lobby login that closes at once. The test can't stop it, because the exe
connects by itself and `no-live-ports` guards only Node's own sockets. Nothing is sent but the login and `ListRooms`.

## 2. "a cut-off server.json taken as an object": an equivalent program on Windows, argued and marked

**What the check is for.** Mono's `JavaScriptSerializer` takes an object cut off before its `}` for a whole object.
Measured here with mono's `System.Web.Extensions`:

| Text | mono |
|---|---|
| `{"host": ` | an object |
| `{"host":"a.b","key":"x"` | an object |
| `{"host":"a.b","key":"x",` | an object |
| `{"host":"a.b","key":"x"} junk` | throws |
| `{"host":"a.b","key":"x"}}` | throws |

**On Windows** .NET Framework's serializer rejects the cut-off object itself. The Windows run shows it: with the check
removed, "refused (isn't valid JSON)" for `{"host": ` still passed. So on Windows the check never changes a result.
- That is an equivalent program there, and no self-test text can make it fail on Windows.
- I couldn't run .NET Framework here, so the claim for the other cut-off shapes (a missing `}`, a trailing comma)
  rests on the serializer reading to a closing brace, not on a run.
- The check stays: the cloud's mono build needs it, and it costs nothing on Windows.

**What changed:**
- **The self-test** (`SelfTestServer.cs`) refuses the three other shapes too: a missing `}`, a trailing comma, and
  trailing junk.
  - Under mono the first two fail without the check (so the mutation fails 5 more checks here).
  - On Windows the serializer refuses all three either way. They document the behaviour, and catch a future serializer
    that is lenient.
- **The tool** marks the mutation `equivalentOn: "win32"`, with the reason.
  - On Windows, if nothing fails, it prints `EQUIVALENT ... on win32: <why>` and counts it apart, not as survived.
  - If anything fails there, it is caught or survived as usual.
  - Under mono it is a normal mutation, and caught.

## Results (mono, this container)

- `node tests/test_companion_own_server.js`: 27 checks pass (the self-test section, with the 3 new cases, is one of them).
- `node tools/mutate-companion-own-server.js`: **30 caught by name, 0 survived**, the real files unchanged (sha256). The stand-in on 9443 was stopped for this run. With it up, the two mutations above are caught by name too.
- Also: `test_companion_page` 242, `test_companion_server` 43, `test_friend_package` 119.

## For the Windows run

`node tools/mutate-companion-own-server.js` should print 29 caught and 1 equivalent on win32 ("a cut-off server.json
taken as an object"), with 0 survived.
