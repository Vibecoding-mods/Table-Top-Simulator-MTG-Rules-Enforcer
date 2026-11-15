// The friend package's builder (tools/make-friend-package.js), its pure parts: the save's stamp and new name, the
// refusals when the deploy record disagrees, the compose file, and reading a docker save tar.
//   node tests/test_friend_package.js [dist/MTG-Table-....zip ...]
// With zips: each built package is unzipped and checked to hold no table (builtZip below).
const { Readable } = require("stream");
const pack = require("../tools/make-friend-package");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// the companion's source goes into the package beside its exe (LICENSES/source/companion, carried by the app part of
// an update): every .cs file byte for byte, build.cmd, and only the public key file
{
  const fs = require("fs"), os = require("os"), path = require("path");
  const tree = path.join(__dirname, ".."), pkg = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-pkg-"));
  try {
    pack.companionSource(tree, pkg);
    const to = path.join(pkg, "LICENSES", "source", "companion");
    const want = fs.readdirSync(path.join(tree, "companion", "src")).filter((f) => f.endsWith(".cs")).sort();
    const got = fs.existsSync(path.join(to, "src")) ? fs.readdirSync(path.join(to, "src")).sort() : [];
    ok("companion source: every .cs file of companion/src is in the package", want.length > 5 && JSON.stringify(got) === JSON.stringify(want), JSON.stringify({ want, got }));
    ok("companion source: byte for byte", want.every((f) => fs.existsSync(path.join(to, "src", f)) && fs.readFileSync(path.join(to, "src", f)).equals(fs.readFileSync(path.join(tree, "companion", "src", f)))));
    ok("companion source: build.cmd and a README beside it", fs.existsSync(path.join(to, "build.cmd")) && fs.existsSync(path.join(to, "README.txt")));
    ok("companion source: in LICENSES, which the update's app part carries", pack.RELEASE_PARTS.app.holds.includes("LICENSES"));
    const keys = fs.existsSync(path.join(to, "release-keys.txt")) ? fs.readFileSync(path.join(to, "release-keys.txt"), "utf8") : "";
    ok("companion source: no private key shipped", !/PRIVATE KEY/.test(keys) && !fs.readdirSync(to).some((f) => /\.(pem|key|p8)$/i.test(f)));
    ok("the friend README points at the companion's source", /LICENSES\\+source\\+companion/.test(pack.readmeText({ nodeVersion: "v0", bridge: "b", table: "t", built: "2026-11-12" })));
  } finally { fs.rmSync(pkg, { recursive: true, force: true }); }
}

// the save: TTS's own layout (CRLF, two-space indent, the script as one escaped string)
const save = '{\r\n  "SaveName": "Mock MTGA 4 player",\r\n  "GameMode": "MTG",\r\n  "LuaScript": "x = 1\\r\\nfunction engineStamp() return \\"0fa50b21\\" end\\r\\n",\r\n  "ObjectStates": [\r\n    {\r\n      "Nickname": "SaveName",\r\n      "Name": "Card"\r\n    }\r\n  ]\r\n}';
{
  same("stamp: read from the Global script", pack.stampOf(save), "0fa50b21");
  same("stamp: none in an old script", pack.stampOf('{"LuaScript":"x = 1"}'), null);
  const renamed = pack.renameSave(save, pack.SAVE_NAME);
  same("rename: the new name", JSON.parse(renamed).SaveName, "MTG Table (rules engine)");
  same("rename: every other byte kept", renamed.replace('"MTG Table (rules engine)"', '"Mock MTGA 4 player"'), save);
  same("rename: the stamp kept", pack.stampOf(renamed), "0fa50b21");
  same("rename: a name with quotes is escaped", JSON.parse(pack.renameSave(save, 'a "b"')).SaveName, 'a "b"');
  let threw = false;
  try { pack.renameSave('{"GameMode": "x"}', "y"); } catch { threw = true; }
  ok("rename: a file with no SaveName is refused", threw);
}

// refusals: one disagreement at a time
{
  const d = { bridge: "b1", table: "t1", save: "s1", node: "sha256:nnnnnnnnnnnnnnnnnnnn", relay: "sha256:rrrrrrrrrrrrrrrrrrrr" };
  const compose = "services:\n  relay:\n    image: mtg-relay:exile\n  forge-room:\n    image: mtg-forge-node:exile\n";
  const good = { deployed: d, tags: { node: d.node, relay: d.relay }, containers: { node: d.node, relay: d.relay }, table: { stamp: "t1", save: "s9" }, bridge: "b1", compose };
  const said = (change, opts) => pack.refusals({ ...good, ...change }, opts);
  same("refuse: nothing when all agree", said({}), []);
  const one = (name, change, word, opts) => { const r = said(change, opts); ok(`refuse: ${name}`, r.length === 1 && r[0].includes(word), JSON.stringify(r)); };
  same("refuse: no deploy record", said({ deployed: null }).length, 1);
  one("an image missing", { tags: { node: null, relay: d.relay } }, "missing");
  one("a tag moved", { tags: { node: "sha256:oooooooooooooooooooo", relay: d.relay } }, "tag moved");
  one("a container on another image", { containers: { node: d.node, relay: "sha256:oooooooooooooooooooo" } }, "running relay container");
  same("refuse: Docker can't say: both containers", said({ containers: { node: null, relay: null } }).length, 2);
  one("the sources make another table than the deploy's", { table: { stamp: "t2", save: "s9" } }, "deploy again");
  one("no Workshop copy to make the table from", { table: { error: "no such file" } }, "Subscribe to https://steamcommunity.com/sharedfiles/filedetails/?id=2296042369");
  one("the patcher refused this PC's Workshop copy", { table: { error: "a patch didn't apply" } }, "a patch didn't apply");
  one("the table not tried", { table: null }, "can't be made");
  same("refuse: the TTS save is no longer read (a Save in TTS changes nothing)", said({ save: { stamp: "t9", sha8: "zz" } }), []);
  one("bridge code not deployed", { bridge: "b2" }, "--allow-undeployed-bridge");
  same("refuse: undeployed bridge, allowed", said({ bridge: "b2" }, { allowUndeployedBridge: true }), []);
  one("compose runs another image", { compose: compose.replace("mtg-relay:exile", "mtg-relay:exile2") }, "doesn't run mtg-relay:exile");
}

// ── the package holds NO Workshop table (Steam lets subscribers use a Workshop item, not hand out copies): it ships
// our patcher, and the companion makes the table from the host's own copy with tools/make-table.js
{
  const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
  const { execFileSync, spawnSync } = require("child_process");
  const mt = require("../tools/make-table");
  const ps = require("../tools/patch-save");
  const tools = path.join(__dirname, "..", "tools");
  const sha8 = (b) => crypto.createHash("sha256").update(b).digest("hex").slice(0, 8);

  // what would be a copy of a Workshop table, named (a planted one fails by its name)
  const clean = [...mt.PATCHER_FILES.map((f) => ({ rel: `table/${f}` })), { rel: "table/README.txt" }, { rel: "version.json", text: '{"bridge":"b","save":"s"}' },
    { rel: "decks/atraxa.json", text: '{"name":"Atraxa","cards":[]}' }, { rel: "stack/deployed.json", text: '{"table":"t"}' }, { rel: "bridge/forge-cards.json", text: "{}" }, { rel: "LICENSES/source/companion/src/Logic.cs" }];
  same("no table copy: the patcher, the README, decks, the records", pack.tableCopies(clean), []);
  for (const bad of [{ rel: "table/MTG Table.json" }, { rel: "table/anything.json" }, { rel: "2296042369.json" }, { rel: "images/2293586471.png" }, { rel: "bridge/TS_Save_3.json" },
    { rel: "decks/sneaky.json", text: '{\r\n  "SaveName": "Mock MTGA 4 player",\r\n  "GameMode": "x",\r\n  "ObjectStates": [' }])
    same(`table copy caught by name: ${bad.rel}`, pack.tableCopies([...clean, bad]), [bad.rel]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-no-table-"));
  try {
    // the package's table folder as main() fills it: the patcher's files, every one in tools/, none of them JSON
    ok("the patcher's files are all in tools/ and none is JSON", mt.PATCHER_FILES.every((f) => fs.existsSync(path.join(tools, f)) && !/\.json$/i.test(f)) && mt.PATCHER_FILES.includes("make-engine-copy.js"));
    const pkg = path.join(tmp, "pkg");
    for (const f of mt.PATCHER_FILES) { fs.mkdirSync(path.join(pkg, "table"), { recursive: true }); fs.copyFileSync(path.join(tools, f), path.join(pkg, "table", f)); }
    fs.writeFileSync(path.join(pkg, "table", "README.txt"), pack.tableReadme());
    fs.mkdirSync(path.join(pkg, "decks"));
    fs.writeFileSync(path.join(pkg, "decks", "a.json"), '{"name":"a"}');
    same("a package folder with the patcher: no table copy", pack.tableCopies(pack.packageEntries(pkg)), []);
    fs.writeFileSync(path.join(pkg, "decks", "b.json"), `{\n  "SaveName": "x",\n  "ObjectStates": []\n}`);
    same("a package folder: a TTS save under another name is caught by its content", pack.tableCopies(pack.packageEntries(pkg)), ["decks/b.json"]);
    fs.rmSync(path.join(pkg, "decks", "b.json"));
    // (the Workshop file's ObjectStates comes after a 130 KB script: the whole file is read, whatever its extension)
    fs.writeFileSync(path.join(pkg, "decks", "c.txt"), `﻿{"SaveName": "x", "LuaScript": "${"-".repeat(200000)}", "ObjectStates": [{}]}`);
    same("a package folder: a save whose ObjectStates is past 64 KB, as .txt with a BOM, is caught", pack.tableCopies(pack.packageEntries(pkg)), ["decks/c.txt"]);
    fs.rmSync(path.join(pkg, "decks", "c.txt"));
    ok("isTtsSave: a deck list, a record or a non-object is not a save", !pack.isTtsSave('{"name":"a","cards":[]}') && !pack.isTtsSave("[1]") && !pack.isTtsSave("x") && !pack.isTtsSave(undefined));
    ok("the table folder's README says where the table comes from", /holds no table/.test(pack.tableReadme()) && pack.tableReadme().includes("https://steamcommunity.com/sharedfiles/filedetails/?id=2296042369"));

    // finish(): the ENGINE MODE save's script stamped as a deploy stamps it, CRLF as patch-save leaves it, renamed
    const engine = JSON.stringify({ SaveName: "MTG 4 player table - ENGINE MODE", GameMode: "x", LuaScript: 'a = 1\r\nfunction engineStamp() return "dev" end\nb()\r\n', ObjectStates: [{ Nickname: "SaveName", LuaScript: "z" }] }, null, 2);
    const f = mt.finish(engine, pack.SAVE_NAME);
    const want = sha8('a = 1\nfunction engineStamp() return "dev" end\nb()\n');
    same("finish: the stamp is the LF script's hash with the stamp at dev", f.stamp, want);
    same("finish: the script stamped, CRLF throughout", JSON.parse(f.text).LuaScript, `a = 1\r\nfunction engineStamp() return "${want}" end\r\nb()\r\n`);
    same("finish: renamed", JSON.parse(f.text).SaveName, "MTG Table (rules engine)");
    same("finish: every other byte kept", f.text.replace(JSON.stringify(JSON.parse(f.text).LuaScript), "S").replace('"MTG Table (rules engine)"', "N"), engine.replace(JSON.stringify(JSON.parse(engine).LuaScript), "S").replace('"MTG 4 player table - ENGINE MODE"', "N"));
    const old = ps.patch(JSON.parse(engine).LuaScript, JSON.parse(engine).LuaScript, {});
    same("finish = a deploy's patch-save on the same save, then the package's rename (byte for byte)", f.text, pack.renameSave(ps.rewrite(engine, old.script), pack.SAVE_NAME));
    let threw = null; try { mt.finish(engine.replace("dev", "v1"), "x"); } catch (e) { threw = e.message; }
    ok("finish: a script without the dev stamp is refused", /engineStamp/.test(threw || ""), threw);

    // the command line the companions run, from the package's table folder (its own copies of the patcher)
    const cli = (...a) => spawnSync(process.execPath, [path.join(pkg, "table", "make-table.js"), ...a], { encoding: "utf8" });
    const said = (r) => { try { return JSON.parse(r.stdout.trim().split("\n").pop()); } catch { return null; } };
    const out = path.join(pkg, "table", "MTG Table.json");
    let r = cli(path.join(tmp, "no-such", "2296042369.json"), out);
    ok("missing Workshop file: exit 3, missing, nothing written", r.status === 3 && said(r)?.missing === true && said(r)?.ok === false && !fs.existsSync(out), r.stdout + r.stderr);
    fs.writeFileSync(path.join(tmp, "not-the-table.json"), JSON.stringify({ SaveName: "Something else", LuaScript: "x = 1", ObjectStates: [] }));
    r = cli(path.join(tmp, "not-the-table.json"), out);
    ok("a Workshop file the patches don't fit: exit 1, the FAIL lines, nothing written", r.status === 1 && said(r)?.ok === false && /a patch didn't apply.*FAIL/.test(said(r)?.error || "") && !fs.existsSync(out), r.stdout + r.stderr);
    r = cli(path.join(tmp, "not-the-table.json"), out, "--table", "6p");
    ok("the 6-player table: not made yet (its patcher is the hook), nothing written", r.status === 1 && /can't be made yet/.test(said(r)?.error || "") && !fs.existsSync(out), r.stdout);
    ok("the 6-player table is listed, optional, with its Workshop link", mt.TABLES["6p"].optional && mt.TABLES["6p"].url === "https://steamcommunity.com/sharedfiles/filedetails/?id=2293586471" && mt.TABLES["4p"].url === "https://steamcommunity.com/sharedfiles/filedetails/?id=2296042369");

    // the real Workshop copy (not in this repo: subscribe to it, or point MTG_WORKSHOP at it)
    const ws = pack.WORKSHOP;
    if (!fs.existsSync(ws)) process.stdout.write(`SKIP the Workshop copy checks: no ${ws} (subscribe to the table, or set MTG_WORKSHOP)\n`);
    else {
      const before = sha8(fs.readFileSync(ws));
      r = cli(ws, out);
      const run = said(r);
      ok("Workshop copy: the companion's run writes the table", r.status === 0 && run?.ok && fs.existsSync(out), r.stdout + r.stderr);
      const bytes = fs.readFileSync(out);
      const b = mt.build(ws);
      ok("Workshop copy: the companion's run from the package = the build's make-table (byte for byte)", bytes.equals(b.bytes) && run.save === b.save && run.stamp === b.stamp && run.save === sha8(bytes));
      // today's path for the same input: make-engine-copy's ENGINE MODE save, a deploy's patch-save on it, the
      // package's rename (tools/make-friend-package.js renamed the deployed save)
      const eng = path.join(tmp, "engine.json");
      execFileSync(process.execPath, [path.join(tools, "make-engine-copy.js"), ws, eng], { stdio: "pipe" });
      const raw = fs.readFileSync(eng, "utf8"), built = JSON.parse(raw);
      const p = ps.patch(built.LuaScript, built.LuaScript, {});
      const deployedSave = ps.addPieces(ps.rewrite(raw, p.script), built);
      ok("Workshop copy: a deploy would add no status pieces (the build has them all)", deployedSave.added.length === 0, deployedSave.added.join(", "));
      const today = Buffer.from(pack.renameSave(deployedSave.raw, pack.SAVE_NAME), "utf8");
      ok("Workshop copy: byte for byte the save today's build ships for this input (make-engine-copy, patch-save, rename)", bytes.equals(today), `${sha8(bytes)} vs ${sha8(today)}`);
      same("Workshop copy: the stamp is the one a deploy gives this script", run.stamp, p.stamp);
      same("Workshop copy: named for TTS's list", JSON.parse(bytes.toString("utf8")).SaveName, "MTG Table (rules engine)");
      ok("Workshop copy: its picture beside the table", fs.existsSync(ws.replace(/\.json$/i, ".png")) === fs.existsSync(out.replace(/\.json$/i, ".png")));
      same("Workshop copy: only read, never written", sha8(fs.readFileSync(ws)), before);
      // the deployed table: when the table's source is the deployed one, the table made here is the deployed table
      const versions = require("../bridge/versions");
      const dep = versions.readManifest();
      if (dep && dep.tableSource === versions.fileHash(versions.TABLE_SOURCE)) same("Workshop copy: the deployed sources make the deployed table", run.stamp, dep.table);
      else process.stdout.write(`SKIP the deployed-table check: the table's source changed since the deploy (made ${run.stamp}, deployed ${dep ? dep.table : "nothing"})\n`);
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// the friend README: what a host needs (the same in README.md and docs/companion-app-spec.md)
{
  const t = pack.readmeText({ nodeVersion: "v0", bridge: "b", table: "t", built: "2026-11-15" });
  for (const [name, re] of [["the section", /^HOST REQUIREMENTS/m], ["Windows 10/11 x64", /Windows 10 or 11 on an x64 processor \(Intel or AMD\)/], ["4 cores, 16 GB, estimates", /4 CPU cores and 16 GB of RAM recommended[\s\S]*2 cores and about 8 GB[\s\S]*estimates/],
    ["2 GB of disk", /About 2 GB of free disk/], ["Docker Desktop's link", /https:\/\/www\.docker\.com\/products\/docker-desktop\//], ["All-users installation", /"All-users installation"/],
    ["wsl --install", /wsl --install {2}in an administrator PowerShell and restart/], ["sign out and in", /sign out of\s+Windows and back in/], ["SVM / VT-x", /SVM \(AMD\) or Intel VT-x/],
    ["the 4-player table", /https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=2296042369/], ["the 6-player table", /https:\/\/steamcommunity\.com\/sharedfiles\/filedetails\/\?id=2293586471/],
    ["friends need only TTS", /friends who only join need just TTS/], ["subscribe before the first start", /Subscribe to the table on the Steam Workshop/]])
    ok(`friend README: ${name}`, re.test(t));
}

// the compose file
{
  const y = pack.composeYaml();
  ok("compose: the project name", /^name: mtg-table$/m.test(y));
  ok("compose: no web client", !/^\s*web:/m.test(y) && !/8080/.test(y));
  same("compose: the two images", [...y.matchAll(/^\s*image: (\S+)$/gm)].map((m) => m[1]), ["mtg-relay:exile", "mtg-forge-node:exile"]);
  const ports = [...y.matchAll(/^\s*- "([^"]+)"/gm)].map((m) => m[1]);
  ok("compose: every port on 127.0.0.1", ports.length === 1 && ports.every((p) => p.startsWith("127.0.0.1:")), JSON.stringify(ports));
  ok("compose: the room the bridge asks for", /SELF_HOSTED_NODE_ROOM_NAME: "tts-commander"/.test(y));
}

// --release: what it refuses, the app part's version, the tag, and the manifest's signature
{
  const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
  same("release: a clean release refuses nothing", pack.releaseRefusals({ build: ["app", "images"], imagesFile: "images/mtg-images.tar", tag: "v2026.11.10-1200" }), []);
  ok("release: new images without the tar (--no-images) refused", pack.releaseRefusals({ build: ["images"], imagesFile: null, tag: "v1" }).some((w) => w.includes("--no-images")));
  same("release: unchanged images without the tar are fine", pack.releaseRefusals({ build: ["app"], imagesFile: null, tag: "v1" }), []);
  ok("release: --allow-undeployed-bridge refused", pack.releaseRefusals({ build: [], imagesFile: "x", tag: "v1", allowUndeployedBridge: true }).some((w) => w.includes("--allow-undeployed-bridge")));
  ok("release: the table part is the patcher folder (table/), which holds no table", JSON.stringify(pack.RELEASE_PARTS.table.holds) === JSON.stringify(["table"]));
  ok("release: format 2 (a format-1 companion takes the new companion first: it would install no table)", pack.UPDATE_FORMAT === 2);
  ok("release: a tag with a slash or of dots refused", [".", "..", "...", "a/b", "a b", ""].every((tag) => pack.releaseRefusals({ build: [], imagesFile: "x", tag }).length === 1));
  ok("tag: release names kept", ["v2026.11.10-1432", "v1", ".v1", "a_b"].every(pack.validTag) && ![".", "..", "x/..", null].some(pack.validTag));
  {
    // every part names the release that holds its file: made now = this tag, carried = the older one (as given)
    const mf = pack.releaseManifest({ tag: "v3", built: "x", gitCommit: "c", partVersions: { app: "a3", table: "s1" }, made: { app: { file: "app.zip", sha256: "a".repeat(64), size: 5 } }, reuse: { table: { file: "table.zip", sha256: "b".repeat(64), size: 6, version: "s1", release: "v1" } }, full: {}, versionJson: {}, deployedJson: {} });
    same("manifest: a part made now names this release", [mf.parts.app.release, mf.parts.app.version], ["v3", "a3"]);
    same("manifest: a carried part keeps its older release", mf.parts.table.release, "v1");
    let threw = null; try { pack.releaseManifest({ tag: "v3", partVersions: { app: "a3" }, made: {}, reuse: {} }); } catch (e) { threw = e.message; }
    ok("manifest: a part neither made nor carried is refused", /neither built nor carried/.test(threw || ""), threw);
  }
  const entries = [{ rel: "bridge/bridge.js", bytes: "b" }, { rel: "decks/a.json", bytes: "{}" }];
  const v = pack.appVersion(entries);
  for (const rel of ["version.json", "stack/deployed.json", "README-FRIEND.txt", "bridge/image-cache-klrmngr.json"])
    same(`app version: ${rel} doesn't count (it changes with every release, or is the friend's own)`, pack.appVersion([...entries, { rel, bytes: `x${rel}` }]), v);
  ok("app version: a changed bridge file counts", pack.appVersion([{ rel: "bridge/bridge.js", bytes: "c" }, entries[1]]) !== v);
  ok("app.zip leaves out the picture cache (the updater keeps the friend's)", pack.APP_EXCLUDED.includes("bridge/image-cache-klrmngr.json"));
  same("keep published: every older release a manifest points at", pack.pointedAt({ version: "v3", parts: { app: { release: "v3" }, images: { release: "v1" }, table: { release: "v2" }, runtime: { release: "v1" } } }), ["v1", "v2"]);

  // the key: made outside the repo on first use, then reused; the signature verifies the way the companion checks it
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "release-key-"));
  try {
    const file = path.join(dir, ".mtg-release", "release-key.pem");
    let threw = null;
    try { pack.releaseKey(path.join(__dirname, "..", "tmp", "release-key.pem"), path.join(__dirname, "..")); } catch (e) { threw = e.message; }
    ok("key: a key file inside the repo is refused", threw && threw.includes("inside the repo"), threw);
    const a = pack.releaseKey(file, path.join(__dirname, ".."));
    const b = pack.releaseKey(file, path.join(__dirname, ".."));
    ok("key: made on first use, then the same key", a.made && !b.made && pack.publicKeyText(a.key) === pack.publicKeyText(b.key));
    const pub = Buffer.from(pack.publicKeyText(a.key), "base64");
    ok("key: the public text is X || Y, 64 bytes", pub.length === 64);
    const bytes = Buffer.from('{"format":1,"version":"v2"}\n');
    const sig = Buffer.from(pack.signManifest(bytes, a.key), "base64");
    const verify = (data, s) => crypto.verify("sha256", data, { key: crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: pub.subarray(0, 32).toString("base64url"), y: pub.subarray(32).toString("base64url") }, format: "jwk" }), dsaEncoding: "ieee-p1363" }, s);
    ok("signature: 64 bytes (r || s) that verify with the public text", sig.length === 64 && verify(bytes, sig));
    ok("signature: a changed manifest doesn't verify", !verify(Buffer.from('{"format":1,"version":"v3"}\n'), sig));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

// a docker save tar, read in odd-sized pieces
{
  const entry = (name, body, type = "0") => {
    const h = Buffer.alloc(512);
    h.write(name, 0);
    h.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
    h.write(type, 156);
    h.write("ustar\0", 257);
    h.write("00", 263);
    return Buffer.concat([h, Buffer.from(body), Buffer.alloc((512 - (body.length % 512)) % 512)]);
  };
  const index = JSON.stringify({ manifests: [
    { digest: "sha256:aaa", annotations: { "io.containerd.image.name": "docker.io/library/mtg-relay:exile" } },
    { digest: "sha256:bbb", annotations: { "io.containerd.image.name": "docker.io/library/mtg-forge-node:exile" } }] });
  const manifest = JSON.stringify([{ Config: "blobs/sha256/ccc", RepoTags: ["mtg-relay:exile"] }, { Config: "blobs/sha256/ddd", RepoTags: ["mtg-forge-node:exile"] }]);
  const tar = Buffer.concat([entry("blobs/", "", "5"), entry("blobs/sha256/x", "z".repeat(1500)), entry("index.json", index), entry("manifest.json", manifest), entry("oci-layout", "{}"), Buffer.alloc(1024)]);
  const pieces = [];
  for (let at = 0, n = 7; at < tar.length; at += n, n = n * 3 % 1013 + 1) pieces.push(tar.subarray(at, at + n));
  pack.tarRead(Readable.from(pieces), ["index.json", "manifest.json"]).then(({ names, text }) => {
    same("tar: every entry", [...names], ["blobs/", "blobs/sha256/x", "index.json", "manifest.json", "oci-layout"]);
    same("tar: index.json read whole", text["index.json"], index);
    const held = pack.tarImages(text);
    same("tar: the images by tag", held, { "mtg-relay:exile": { id: "sha256:aaa", config: "sha256:ccc" }, "mtg-forge-node:exile": { id: "sha256:bbb", config: "sha256:ddd" } });
    // the tar against the deploy record, and the package's record
    const dep = { bridge: "b1", table: "t1", save: "s1", relay: "sha256:aaa", node: "sha256:bbb", at: "then" };
    same("tar check: the deployed images", pack.tarMismatch(held, dep), []);
    const off = pack.tarMismatch(held, { ...dep, node: "sha256:eee" });
    ok("tar check: another engine id is named", off.length === 1 && off[0].includes("mtg-forge-node:exile") && off[0].includes("sha256:bbb") && off[0].includes("sha256:eee"), JSON.stringify(off));
    ok("tar check: the config id is not the deployed id", pack.tarMismatch(held, { ...dep, relay: "sha256:ccc" }).length === 1);
    const missing = pack.tarMismatch({ "mtg-relay:exile": held["mtg-relay:exile"] }, dep);
    ok("tar check: a tag missing from the tar", missing.length === 1 && missing[0].includes("as nothing"), JSON.stringify(missing));
    const rec = pack.deployedRecord(dep, { bridge: "b9", save: "s9", at: "now", images: held });
    same("record: the package's code and save, the config ids", rec, { ...dep, bridge: "b9", save: "s9", at: "now", nodeConfig: "sha256:ddd", relayConfig: "sha256:ccc" });
    same("record: --no-images keeps the deployed ids only", pack.deployedRecord(dep, { bridge: "b9", save: "s9", at: "now" }), { ...dep, bridge: "b9", save: "s9", at: "now" });
    // what the bridge then says: the containerd store runs the index ids, the classic store the config ids
    const { outOfStep } = require("../bridge/versions");
    const now = { bridge: "b9", table: "t1" };
    same("bridge: containerd store ids are the deployed ones", outOfStep({ ...now, node: "sha256:bbb", relay: "sha256:aaa" }, rec), []);
    same("bridge: classic store ids are too", outOfStep({ ...now, node: "sha256:ddd", relay: "sha256:ccc" }, rec), []);
    same("bridge: one of each", outOfStep({ ...now, node: "sha256:ddd", relay: "sha256:aaa" }, rec), []);
    same("bridge: another image is still named", outOfStep({ ...now, node: "sha256:fff", relay: "sha256:ccc" }, rec), ["The engine isn't the deployed image."]);
    same("bridge: another relay too", outOfStep({ ...now, node: "sha256:bbb", relay: "sha256:fff" }, rec), ["The relay isn't the deployed image."]);
    same("bridge: no config ids in the repo's record: a config id is another image", outOfStep({ ...now, bridge: "b1", node: "sha256:ddd", relay: "sha256:aaa" }, dep), ["The engine isn't the deployed image."]);
  }).catch((e) => ok("tar", false, e.stack)).finally(() => {
    for (const zip of process.argv.slice(2)) builtZip(require("path").resolve(zip));
    process.stdout.write(failed ? `\n${failed} friend package checks failed (${passed} passed)\n` : `all ${passed} friend package checks pass\n`);
    process.exit(failed ? 1 : 0);
  });
}

// A built package (the zip a friend gets) holds NO table: no file named like a TTS save, the Workshop file or a
// table/ JSON, no file that is a TTS save (a JSON object with ObjectStates) under any name, and no file byte for byte
// the Workshop copy on this PC or the table made from it. Each offender is named. The images tar is only listed.
function builtZip(zip) {
  const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
  const { execFileSync } = require("child_process");
  const mt = require("../tools/make-table");
  const TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
  const tag = path.basename(zip);
  if (!fs.existsSync(zip)) { ok(`${tag}: the zip is there`, false, zip); return; }
  const names = execFileSync(TAR, ["-t", "-f", zip], { encoding: "utf8", maxBuffer: 1 << 26 }).split(/\r?\n/).filter(Boolean);
  const top = names[0].split("/")[0];
  ok(`${tag}: one folder at the top`, names.every((n) => n.split("/")[0] === top), top);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-zip-check-"));
  try {
    execFileSync(TAR, ["-x", "-f", zip, "-C", tmp, "--exclude", `${top}/images/*`], { stdio: "pipe", timeout: 600000 });
    const root = path.join(tmp, top);
    const entries = pack.packageEntries(root);
    const unread = names.filter((n) => n.startsWith(`${top}/images/`) && !n.endsWith("/")).map((n) => ({ rel: n.slice(top.length + 1) }));
    same(`${tag}: no copy of a Workshop table in it (by name or content)`, pack.tableCopies([...entries, ...unread]), []);
    // byte for byte: this PC's Workshop copies and the table made from the 4-player one
    const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
    const known = {};
    const ws4 = pack.WORKSHOP;
    for (const t of Object.values(mt.TABLES)) {
      const f = path.join(path.dirname(ws4), `${t.id}.json`);
      if (fs.existsSync(f)) known[sha(fs.readFileSync(f))] = `the Workshop file ${t.id}.json`;
    }
    if (fs.existsSync(ws4)) { try { known[sha(mt.build(ws4).bytes)] = "the table made from it"; } catch { /* the patcher refused: nothing to compare */ } }
    if (!Object.keys(known).length) process.stdout.write(`SKIP ${tag}: byte-for-byte check (no Workshop copy on this PC)\n`);
    const same8 = entries.filter((e) => known[sha(fs.readFileSync(path.join(root, e.rel)))]).map((e) => `${e.rel} = ${known[sha(fs.readFileSync(path.join(root, e.rel)))]}`);
    same(`${tag}: no file is byte for byte this PC's Workshop table or the table made from it`, same8, []);
    const table = fs.existsSync(path.join(root, "table")) ? fs.readdirSync(path.join(root, "table")).sort() : [];
    same(`${tag}: table/ holds only the patcher and its README`, table, [...mt.PATCHER_FILES, "README.txt"].sort());
    const v = JSON.parse(fs.readFileSync(path.join(root, "version.json"), "utf8"));
    ok(`${tag}: version.json names the Workshop table (and the 6-player one as optional)`, v.workshop?.id === "2296042369" && v.tables?.[0]?.id === "2296042369" && v.tables.some((t) => t.id === "2293586471" && t.optional === true), JSON.stringify(v.tables));
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
