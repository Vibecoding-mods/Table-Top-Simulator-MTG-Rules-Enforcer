// The GIPHY key on the host's PC (bridge/gifs.js jsonFileStore, the store bridge.js gives createGifs for gif-keys.json):
// a FAKE key in a temp folder, never the real file (%APPDATA%/MTG-TTS is never named here). Saved whole then renamed
// (no half-written file, no .tmp left), read back by a new bridge, removed, a missing file is no key, a corrupt one is
// no key and the log quotes none of it, the status shows only the last four characters, and a failed write says so
// without the key. Also: bridge.js hands createGifs this store, with 0o600, and none at all to a test bridge.
//   node tests/test_gif_key_file.js
require("./no-live-ports");
const fs = require("fs");
const os = require("os");
const path = require("path");
const G = require("../bridge/gifs");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${typeof why === "string" ? why : JSON.stringify(why)}` : ""}\n`); } };

const FAKE = "FakeKeyForTests0123456789abcd"; // (letters and digits, the shape setKey takes; not a GIPHY key)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gif-keys-"));
const file = path.join(tmp, "MTG-TTS", "gif-keys.json");
const logs = [];
const make = (store) => G.createGifs({ fetch: async () => { throw new Error("no network in this test"); }, now: () => 1, store, log: (s) => logs.push(s) });

{
  const g = make(G.jsonFileStore(file, { mode: 0o600 }));
  ok("no file: no key", g.hasKey() === false);
  const r = g.setKey("giphy", FAKE);
  ok("save: accepted, and the message doesn't repeat the key", r.ok && !r.message.includes(FAKE), r);
  ok("save: the file holds the key, under its provider", fs.existsSync(file) && JSON.parse(fs.readFileSync(file, "utf8")).giphy === FAKE);
  ok("save: no .tmp left beside it (written then renamed)", !fs.existsSync(`${file}.tmp`) && fs.readdirSync(path.dirname(file)).length === 1, fs.readdirSync(path.dirname(file)));
  if (process.platform !== "win32") ok("save: only the owner can read it (0600)", (fs.statSync(file).mode & 0o777) === 0o600, (fs.statSync(file).mode & 0o777).toString(8));
  const st = g.state();
  ok("status: says a key is set and its last four characters, never the key", st.giphy.set === true && st.giphy.ends === FAKE.slice(-4) && !JSON.stringify(st).includes(FAKE), st);
}
{
  const g2 = make(G.jsonFileStore(file));
  ok("read back: a new bridge finds the saved key", g2.hasKey() === true);
  const r = g2.setKey("giphy", "");
  ok("remove: the key is gone from the file and from the bridge", r.ok && g2.hasKey() === false && JSON.parse(fs.readFileSync(file, "utf8")).giphy === undefined);
  ok("remove: a new bridge has none either", make(G.jsonFileStore(file)).hasKey() === false);
}
{
  const bad = make(G.jsonFileStore(file));
  const r = bad.setKey("giphy", "not a key!");
  ok("refused: a key of the wrong shape isn't saved", !r.ok && !JSON.parse(fs.readFileSync(file, "utf8")).giphy);
}
{
  fs.writeFileSync(file, `{"giphy":${FAKE}`); // (cut short: not JSON)
  logs.length = 0;
  const g3 = make(G.jsonFileStore(file));
  ok("corrupt file: no key", g3.hasKey() === false);
  ok("corrupt file: logged by the error's name, quoting none of the file", logs.some((l) => /can't read them \(SyntaxError\)/.test(l)) && !logs.join("\n").includes(FAKE.slice(0, 8)), logs);
}
{
  const dirAsFile = path.join(tmp, "blocked");
  fs.writeFileSync(dirAsFile, "a file where the folder should be");
  const g4 = make(G.jsonFileStore(path.join(dirAsFile, "gif-keys.json")));
  const r = g4.setKey("giphy", FAKE);
  ok("a write that fails: not ok, said, and the message has no key", !r.ok && /Couldn't save the key/.test(r.message) && !r.message.includes(FAKE), r);
}
{
  const missing = G.jsonFileStore(path.join(tmp, "none", "gif-keys.json"));
  ok("store: a missing file reads as null", missing.read() === null);
}

// bridge.js wires it: the key file through this store with 0o600; a test bridge (not LIVE, no MTG_GIF_KEYS) gets none
{
  const src = fs.readFileSync(path.join(__dirname, "..", "bridge", "bridge.js"), "utf8");
  ok("bridge: the key store is jsonFileStore(GIF_KEY_FILE) with 0o600", src.includes("store: GIF_KEY_FILE && gifLib.jsonFileStore(GIF_KEY_FILE, { mode: 0o600 })"));
  ok("bridge: the key file is MTG_GIF_KEYS, else only a LIVE bridge's APPDATA file", /const GIF_KEY_FILE = process\.env\.MTG_GIF_KEYS\s*\|\| \(LIVE \? /.test(src));
}

ok("no key in the log, ever", !logs.join("\n").includes(FAKE));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
