// The companion's self-update (docs/companion-app-spec.md §18) end to end: the built exe in a temp package against a
// fake GitHub (releases signed with a test key, assets with a redirect to a second host, Range, a first-try 500, a cut
// download, a wrong Content-Range) and a fake bridge /state. The bridge, Docker and save steps are written to a file (--fake-effects), so nothing real is touched:
// no Docker, no TTS saves, no live bridge (--bridge-url points at the fake).
//   node tests/test_companion_update.js        (builds companion\bin\MTG Companion.exe first when it is stale)
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const zlib = require("zlib");
const { spawn, execFileSync } = require("child_process");
const pack = require("../tools/make-friend-package");

const REPO = path.join(__dirname, "..");
const COMPANION = path.join(REPO, "companion");
const EXE = process.env.COMPANION_EXE || path.join(COMPANION, "bin", "MTG Companion.exe"); // (COMPANION_EXE: the mutation pass's build)
const TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
const API = "/repos/Vibecoding-mods/Table-Top-Simulator-Mock-MTGA";
let failed = 0, passed = 0;
const ok = (name, cond, why) => {
  if (cond) { passed++; return; }
  failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`);
  if (process.env.FAIL_FAST) process.exit(1); // (mutation runs: the first failure is enough)
};
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };
const json = (f) => JSON.parse(fs.readFileSync(f, "utf8"));

// the exe, rebuilt when a source is newer
function build() {
  if (process.env.COMPANION_EXE) return;
  const srcs = [...fs.readdirSync(path.join(COMPANION, "src")).map((f) => path.join(COMPANION, "src", f)), path.join(COMPANION, "build.cmd")];
  if (fs.existsSync(EXE) && srcs.every((f) => fs.statSync(f).mtimeMs <= fs.statSync(EXE).mtimeMs)) return;
  execFileSync("cmd", ["/c", path.join(COMPANION, "build.cmd")], { stdio: "ignore", timeout: 300000 });
}

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "companion-update-"));
// PowerShell helpers (a held file, a held mutex, a stand-in old app): started outside any test folder and killed at
// the exit, so a FAIL_FAST exit leaves nothing running that holds a folder
const helpers = [];
const helperPs = (command, stdio) => { const c = spawn("powershell.exe", ["-NoProfile", "-Command", command], { cwd: os.tmpdir(), stdio }); helpers.push(c); return c; };
process.on("exit", () => {
  for (const c of helpers) try { if (c.exitCode === null) c.kill(); } catch {}
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
});
// the fake GitHub's release key (the exe trusts it through --test-public-key, which needs a loopback --update-base)
const KEY = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
const OTHER_KEY = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
const PUB = pack.publicKeyText(KEY);
const RID = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
const NID = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
const BASE_PARTS = { app: "a1", table: "s1", images: pack.imagesVersion(NID, RID), runtime: "v24.1.0", companion: "c1" };

// a package as v1 left it
let pkgN = 0;
const PKG_BUILT = "2026-11-01T09:00:00.000Z";
function makePkg(parts = BASE_PARTS, versionExtra = {}) {
  const pkg = path.join(ROOT, `pkg${++pkgN}`);
  const put = (rel, text) => { const p = path.join(pkg, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  put("version.json", JSON.stringify({ bridge: "b1", table: "t1", save: "s1", node: NID, relay: RID, built: PKG_BUILT, release: "v1", nodeVersion: "v24.1.0", parts, ...versionExtra }));
  put("bridge/bridge.js", "// old bridge\n");
  put("bridge/old-only.js", "// gone after the update\n");
  put("decks/a.json", "{}");
  put("stack/compose.yml", "name: mtg-table\n");
  put("stack/deployed.json", JSON.stringify({ bridge: "b1", nodeConfig: "sha256:this-pc" })); // (nodeConfig: what RewriteDeployed recorded here)
  put("bridge/image-cache-klrmngr.json", "my picture cache");
  put("table/MTG Table.json", "old table");
  put("images/mtg-images.tar", "old tar");
  put("runtime/node/node.exe", "old node");
  put("README-FRIEND.txt", "old readme");
  fs.mkdirSync(path.join(pkg, "logs"), { recursive: true });
  fs.copyFileSync(EXE, path.join(pkg, "MTG Companion.exe"));
  return { pkg, state: path.join(pkg, "..", `state${pkgN}`), log: path.join(pkg, "logs", "companion.log"), fx: path.join(pkg, "..", `fx${pkgN}.txt`) };
}

// ── the fake GitHub

const server = { releases: {}, latest: null, latestStatus: 200, assets: {}, requests: [], game: false, hold: {}, failOnce: new Set(), cutOnce: new Set(), redirectOff: new Set(), badRange: new Set(), flood: new Set(), floodSent: {} };
let PORT = 0, BASE = "";
// a download held until the test lets it go (the package changes meanwhile): hold.hit resolves when it is asked for
const holdDl = (key) => { const h = {}; h.wait = new Promise((r) => { h.release = r; }); h.asked = new Promise((r) => { h.hit = r; }); server.hold[key] = h; return h; };
const handle = (req, res) => {
  const u = new URL(req.url, "http://x");
  server.requests.push({ host: req.headers.host, path: u.pathname, auth: req.headers.authorization || null, range: req.headers.range || null, ua: req.headers["user-agent"] });
  const send = (code, body, headers = {}) => { res.writeHead(code, { "Content-Type": "application/json", ...headers }); res.end(body); };
  if (u.pathname === "/state") return send(200, JSON.stringify(server.game ? { started: true, seats: [{ turn: 3 }] } : { started: false, seats: null }));
  if (u.pathname === `${API}/releases/latest`) return server.latestStatus !== 200 || !server.latest ? send(server.latestStatus, '{"message":"Not Found"}') : send(200, JSON.stringify(releaseJson(server.latest)));
  let m = /^\/repos\/[^/]+\/[^/]+\/releases\/tags\/(.+)$/.exec(u.pathname);
  if (m) return server.releases[m[1]] ? send(200, JSON.stringify(releaseJson(m[1]))) : send(404, "{}");
  m = /^\/repos\/[^/]+\/[^/]+\/releases\/assets\/(\d+)$/.exec(u.pathname);
  if (m) {
    const a = server.assets[m[1]];
    if (!a) return send(404, "{}");
    if (req.headers.accept !== "application/octet-stream") return send(415, "{}");
    if (server.redirectOff.has(`${a.tag}/${a.name}`)) return send(302, "", { Location: "https://example.com/stolen" });
    return send(302, "", { Location: `http://localhost:${PORT}/dl/${a.tag}/${a.name}` }); // (the asset host: another name)
  }
  m = /^\/dl\/([^/]+)\/([^/]+)$/.exec(u.pathname);
  if (m) {
    const body = server.releases[m[1]]?.files[m[2]];
    if (!body) return send(404, "{}");
    const key = `${m[1]}/${m[2]}`;
    const held = server.hold[key];
    if (held) { delete server.hold[key]; held.hit(); return held.wait.then(() => handle(req, res)); }
    if (server.failOnce.delete(key)) return send(500, "{}");
    const r = /^bytes=(\d+)-$/.exec(req.headers.range || "");
    const from = r ? Number(r[1]) : 0;
    if (from >= body.length) return send(416, "");
    // a server that answers a Range with the whole file as a 206 (Content-Range from 0): the client must start again
    // a server that sends far more than the part's size (64 MB, no Content-Length): the client must stop reading
    if (server.flood.delete(key)) {
      res.writeHead(200, { "Content-Type": "application/octet-stream" });
      const junk = Buffer.alloc(1 << 16, 120);
      let sent = 0, closed = false;
      res.on("close", () => { closed = true; server.floodSent[key] = sent; });
      const pump = () => {
        while (!closed && sent < 64 * 1048576) { sent += junk.length; if (!res.write(junk)) return res.once("drain", pump); }
        if (!closed) { server.floodSent[key] = sent; res.end(); }
      };
      return pump();
    }
    if (r && server.badRange.delete(key)) { res.writeHead(206, { "Content-Type": "application/octet-stream", "Content-Length": body.length, "Content-Range": `bytes 0-${body.length - 1}/${body.length}` }); return res.end(body); }
    res.writeHead(r ? 206 : 200, { "Content-Type": "application/octet-stream", "Content-Length": body.length - from, ...(r ? { "Content-Range": `bytes ${from}-${body.length - 1}/${body.length}` } : {}) });
    if (server.cutOnce.delete(key)) { res.write(body.subarray(from, from + Math.floor((body.length - from) / 2))); setTimeout(() => res.destroy(), 50); return; }
    return res.end(body.subarray(from));
  }
  send(404, "{}");
};
const srv = http.createServer(handle);
function releaseJson(tag) {
  const r = server.releases[tag];
  return { tag_name: tag, assets: Object.entries(r.files).map(([name, body]) => ({ name, size: body.length, url: r.urls?.[name] || `${BASE}${API}/releases/assets/${r.ids[name]}` })) };
}
let assetId = 100;
// a release: files { name: Buffer }; manifest made by the packager's own releaseManifest
function addRelease(tag, files, urls) {
  const ids = {};
  for (const name of Object.keys(files)) { ids[name] = ++assetId; server.assets[assetId] = { tag, name }; }
  server.releases[tag] = { files, ids, urls };
}

// zips made the way the packager makes them (Windows' bsdtar)
let zipN = 0;
function zipOf(entries) {
  const dir = path.join(ROOT, `zip${++zipN}`);
  for (const [rel, text] of Object.entries(entries)) { const p = path.join(dir, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); }
  const out = `${dir}.zip`;
  execFileSync(TAR, ["-a", "-c", "-f", out, "-C", dir, ...new Set(Object.keys(entries).map((r) => r.split("/")[0]))]);
  return fs.readFileSync(out);
}

// a zip written by hand (stored, no compression), for entry names no folder on Windows can hold ("bridge/.. /x")
function rawZip(entries) {
  const locals = [], central = [];
  let off = 0;
  for (const [name, text] of Object.entries(entries)) {
    const data = Buffer.from(text), nm = Buffer.from(name, "utf8"), crc = zlib.crc32(data);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x800, 6); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x800, 8); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    locals.push(h, nm, data); central.push(c, nm);
    off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22), n = Object.keys(entries).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

// a release whose parts are { part: { version, body } | { version, release } (carried by an older one) }.
// sign: "key" (the trusted test key), "other" (a key the exe doesn't trust), "none" (no .sig), "tamper" (signed, then changed)
function publish(tag, parts, { previous = null, sha = {}, urls, sign = "key", version = tag, minCompanion, built = "2026-11-10T12:00:00.000Z" } = {}) {
  const partVersions = Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, p.version]));
  const files = {}, made = {}, reuse = {};
  for (const [k, p] of Object.entries(parts)) {
    if (p.release) { reuse[k] = { ...previous.parts[k], release: p.release }; continue; }
    const file = pack.RELEASE_PARTS[k].file;
    files[file] = p.body;
    made[k] = { file, sha256: sha[k] || sha256(p.body), size: p.body.length };
  }
  const versionJson = { bridge: "b2", table: "t2", save: partVersions.table, node: NID, relay: RID, built, release: tag, parts: partVersions };
  const manifest = pack.releaseManifest({ tag: version, built: versionJson.built, gitCommit: "abc1234", partVersions, made, reuse, full: { file: "full.zip", sha256: "0".repeat(64), size: 1 }, versionJson, deployedJson: { bridge: "b2", table: "t2" } });
  if (minCompanion != null) manifest.minCompanion = minCompanion;
  for (const p of Object.values(manifest.parts)) if (p.release === version) p.release = tag;
  const bytes = Buffer.from(JSON.stringify(manifest));
  files["update-manifest.json"] = sign === "tamper" ? Buffer.from(JSON.stringify({ ...manifest, gitCommit: "evil" })) : bytes;
  if (sign !== "none") files["update-manifest.json.sig"] = Buffer.from(pack.signManifest(bytes, sign === "other" ? OTHER_KEY : KEY));
  addRelease(tag, files, urls);
  return manifest;
}

// the exe, without waiting on the event loop (the fake server answers it)
function run(p, args, stdin) {
  return new Promise((done) => {
    const child = spawn(path.join(p.pkg, "MTG Companion.exe"), [...args, "--update-base", BASE, "--test-public-key", PUB, "--bridge-url", BASE, "--state", p.state, "--log", p.log], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d) => { out += d; });
    child.stderr.on("data", (d) => { out += d; });
    if (stdin != null) child.stdin.end(stdin); else child.stdin.end();
    const t = setTimeout(() => child.kill(), 120000);
    child.on("exit", (code) => { clearTimeout(t); done({ code, out: out.trim() }); });
  });
}
const now = (p) => run(p, ["--update-now", "--fake-effects", p.fx]);
const effects = (p) => (read(p.fx) || "").trim().split(/\r?\n/).filter(Boolean);
const dl = () => server.requests.filter((r) => r.path.startsWith("/dl/") && !/\/update-manifest\.json(\.sig)?$/.test(r.path)).map((r) => r.path.replace(/^\/dl\//, ""));
const latestHits = () => server.requests.filter((q) => q.path === `${API}/releases/latest`).length;
// every file in a package (but logs\), for "exactly as it was"
const tree = (d, base = d) => (!fs.existsSync(d) ? [] : fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? tree(path.join(d, e.name), base) : [path.relative(base, path.join(d, e.name)).replace(/\\/g, "/")]))).filter((f) => !f.startsWith("logs/")).sort();
const snapshot = (pkg) => Object.fromEntries(tree(pkg).map((f) => [f, sha256(fs.readFileSync(path.join(pkg, f)))]));
const reset = () => { server.requests = []; server.game = false; server.latestStatus = 200; };
const wait = async (cond, ms = 30000) => { for (const t0 = Date.now(); Date.now() - t0 < ms; await new Promise((r) => setTimeout(r, 250))) if (cond()) return true; return cond(); };

const v1Manifest = { version: "v1", parts: Object.fromEntries(Object.entries(BASE_PARTS).map(([k, v]) => [k, { file: pack.RELEASE_PARTS[k].file, sha256: "f".repeat(64), size: 1, version: v, release: "v1" }])) };
const unchanged = (k) => ({ version: BASE_PARTS[k], release: "v1" });
const newApp = () => zipOf({ "bridge/bridge.js": "// new bridge\n", "decks/b.json": "{}", "stack/compose.yml": "name: mtg-table\n", "README-FRIEND.txt": "new readme" });

async function main() {
  build();
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  PORT = srv.address().port; BASE = `http://127.0.0.1:${PORT}`;
  addRelease("v1", {});

  // 1. up to date
  {
    reset();
    publish("v2", { app: unchanged("app"), table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v2";
    const p = makePkg();
    const r = await now(p);
    ok("up to date: says so, exit 0", r.code === 0 && r.out.includes("Up to date (v2)"), JSON.stringify(r));
    same("up to date: nothing downloaded", dl(), []);
    same("up to date: nothing done", effects(p), []);
    ok("up to date: the user agent, nothing else", server.requests.every((q) => q.ua === "MTG-Companion" && q.auth === null), JSON.stringify(server.requests[0]));
  }

  // 1b. a package with no images version of its own: derived from its ids the way the packager does
  {
    reset();
    server.latest = "v2";
    const { images, ...rest } = BASE_PARTS;
    const p = makePkg(rest);
    const r = await run(p, ["--update-check"]);
    ok("derived images version: the same as the packager's (up to date)", r.code === 0 && r.out.includes("Up to date (v2)"), JSON.stringify(r));
  }

  // 2. a new app only
  {
    reset();
    const m = publish("v3", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v3";
    const p = makePkg();
    const check = await run(p, ["--update-check"]);
    ok("new app: --update-check offers it (exit 10), changes nothing", check.code === 10 && check.out.includes("Update available: v3 (bridge and decks;") && read(path.join(p.pkg, "bridge", "bridge.js")) === "// old bridge\n", JSON.stringify(check));
    const r = await now(p);
    ok("new app: updated, exit 0", r.code === 0 && r.out.includes("Updated to v3"), JSON.stringify(r));
    same("new app: only app.zip downloaded", dl(), ["v3/app.zip"]);
    same("new app: the bridge stopped and started, no images, no save", effects(p), ["stop-bridge", "reload", "start-bridge"]);
    same("new app: the new bridge", read(path.join(p.pkg, "bridge", "bridge.js")), "// new bridge\n");
    ok("new app: the old bridge's extra file is gone (the folder is replaced)", !fs.existsSync(path.join(p.pkg, "bridge", "old-only.js")));
    ok("new app: the table and images untouched", read(path.join(p.pkg, "table", "MTG Table.json")) === "old table" && read(path.join(p.pkg, "images", "mtg-images.tar")) === "old tar");
    const v = json(path.join(p.pkg, "version.json"));
    ok("new app: version.json from the release", v.release === "v3" && v.parts.app === "a2" && v.bridge === "b2", JSON.stringify(v));
    same("new app: deployed.json from the release, this PC's image ids kept (no new images)", json(path.join(p.pkg, "stack", "deployed.json")), { ...m.deployedJson, nodeConfig: "sha256:this-pc" });
    same("new app: the friend's picture cache kept", read(path.join(p.pkg, "bridge", "image-cache-klrmngr.json")), "my picture cache");
    ok("new app: no journal left", !fs.existsSync(path.join(p.pkg, "update-journal.json")));
    same("new app: the old files in backup\\v1", read(path.join(p.pkg, "backup", "v1", "bridge", "bridge.js")), "// old bridge\n");
    ok("new app: the download folder is cleared", !fs.existsSync(path.join(p.pkg, "updates", "v3")));
    const again = await run(p, ["--update-check"]);
    ok("new app: then up to date", again.code === 0 && again.out.includes("Up to date (v3)"), JSON.stringify(again));
  }

  // 3. new images only: the tar alone, from the older release that carries it
  {
    reset();
    const tar = Buffer.from("new images tar ".repeat(5000));
    const iv = pack.imagesVersion(NID.replace(/2/g, "3"), RID);
    const m4 = publish("v4", { app: unchanged("app"), table: unchanged("table"), images: { version: iv, body: tar }, runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    publish("v5", { app: unchanged("app"), table: unchanged("table"), images: { version: iv, release: "v4" }, runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: m4 });
    server.latest = "v5";
    server.cutOnce.add("v4/images.tar"); // (the first download stops half way: the second resumes)
    const p = makePkg();
    const r = await now(p);
    ok("new images: updated", r.code === 0 && r.out.includes("Updated to v5"), JSON.stringify(r));
    ok("new images: only the tar, from release v4", dl().length >= 1 && dl().every((d) => d === "v4/images.tar"), JSON.stringify(dl()));
    ok("new images: v4 looked up by its tag", server.requests.some((q) => q.path === `${API}/releases/tags/v4`));
    ok("new images: the cut download resumed with Range", server.requests.some((q) => q.path === "/dl/v4/images.tar" && /^bytes=\d+-$/.test(q.range || "")), JSON.stringify(server.requests.filter((q) => q.path.startsWith("/dl")).map((q) => q.range)));
    ok("new images: the tar in images\\", fs.readFileSync(path.join(p.pkg, "images", "mtg-images.tar")).equals(tar));
    same("new images: loaded (docker load + compose up), bridge restarted", effects(p), ["stop-bridge", "reload", "load-images", "start-bridge"]);
    same("new images: the bridge untouched", read(path.join(p.pkg, "bridge", "bridge.js")), "// old bridge\n");
    same("new images: the old tar in the backup", read(path.join(p.pkg, "backup", "v1", "images", "mtg-images.tar")), "old tar");
    ok("new images: the downloaded tar moved, not copied (the download folder is gone)", !fs.existsSync(path.join(p.pkg, "updates", "v5")));
    same("new images: deployed.json the release's (new images: new ids)", json(path.join(p.pkg, "stack", "deployed.json")), { bridge: "b2", table: "t2" });
  }

  // 4. a download that doesn't match its sha256: deleted, refused
  {
    reset();
    publish("v6", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest, sha: { app: "e".repeat(64) } });
    server.latest = "v6";
    server.failOnce.add("v6/app.zip"); // (and a first-try 500: retried)
    const p = makePkg();
    const r = await now(p);
    ok("sha mismatch: refused, exit 1", r.code === 1 && r.out.includes("didn't match the release's checksum"), JSON.stringify(r));
    ok("sha mismatch: after a 500 it tried again", dl().filter((d) => d === "v6/app.zip").length === 2, JSON.stringify(dl()));
    ok("sha mismatch: the file deleted", !fs.existsSync(path.join(p.pkg, "updates", "v6", "app.zip")) && !fs.existsSync(path.join(p.pkg, "updates", "v6", "app.zip.part")));
    same("sha mismatch: nothing done", effects(p), []);
    same("sha mismatch: the bridge untouched", read(path.join(p.pkg, "bridge", "bridge.js")), "// old bridge\n");
  }

  // 5. a private repository (404): the quiet line
  {
    reset();
    server.latestStatus = 404;
    const p = makePkg();
    const r = await now(p);
    ok("404: the quiet line, exit 0", r.code === 0 && r.out === "Updates will work once the project is public.", JSON.stringify(r));
    ok("404: remembered for the tray", (read(path.join(p.state, "updates.json")) || "").includes("once the project is public"));
  }

  // 6. a game on: downloaded, installed after the game
  {
    reset();
    publish("v7", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v7";
    server.game = true;
    const p = makePkg();
    const r = await now(p);
    ok("game on: deferred, exit 3", r.code === 3 && r.out.includes("Update ready — will install after this game"), JSON.stringify(r));
    same("game on: nothing done", effects(p), []);
    same("game on: the bridge untouched", read(path.join(p.pkg, "bridge", "bridge.js")), "// old bridge\n");
    ok("game on: the download kept", fs.existsSync(path.join(p.pkg, "updates", "v7", "app.zip")));
    same("game on: the waiting update remembered (updates.json pending)", json(path.join(p.state, "updates.json")).pending, "v7");
    // a download changed on disk while it waited: the install refuses it (verified again at the start of the install)
    const zipFile = path.join(p.pkg, "updates", "v7", "app.zip"), good = fs.readFileSync(zipFile);
    fs.writeFileSync(zipFile, Buffer.concat([good.subarray(0, good.length - 1), Buffer.from([good[good.length - 1] ^ 1])]));
    server.game = false;
    const bad = await run(p, ["--update-now", "--fake-effects", p.fx, "--apply-update", "v7"]);
    ok("changed download: refused at the install", bad.code === 1 && bad.out.includes("isn't fully downloaded"), JSON.stringify(bad));
    same("changed download: nothing done", effects(p), []);
    fs.writeFileSync(zipFile, good);
    const stored = path.join(p.pkg, "updates", "v7", "update-manifest.json"), signedBytes = fs.readFileSync(stored);
    fs.writeFileSync(stored, Buffer.from(signedBytes.toString("utf8").replace('"gitCommit":"abc1234"', '"gitCommit":"abc1235"')));
    const forged = await run(p, ["--update-now", "--fake-effects", p.fx, "--apply-update", "v7"]);
    ok("changed manifest on disk: refused at the install", forged.code === 1 && forged.out.includes("isn't signed by this project's release key"), JSON.stringify(forged));
    same("changed manifest on disk: nothing done", effects(p), []);
    fs.writeFileSync(stored, signedBytes);
    server.game = true;
    server.game = false; server.requests = [];
    const r2 = await now(p);
    ok("game over: installed", r2.code === 0 && r2.out.includes("Updated to v7"), JSON.stringify(r2));
    same("game over: not downloaded again", dl(), []);
    ok("game over: nothing waits any more", json(path.join(p.state, "updates.json")).pending === undefined, read(path.join(p.state, "updates.json")));
  }

  // 7. a failed apply is undone
  {
    reset();
    const tar = Buffer.from("tar that won't load");
    publish("v8", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: { version: "i9", body: tar }, runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v8";
    const p = makePkg();
    const before = read(path.join(p.pkg, "version.json"));
    const r = await run(p, ["--update-now", "--fake-effects", p.fx, "--fake-fail", "start-bridge"]);
    ok("failed: undone, exit 1", r.code === 1 && r.out.includes("The update failed and was undone: the new bridge didn't start"), JSON.stringify(r));
    same("failed: the old bridge back", read(path.join(p.pkg, "bridge", "bridge.js")), "// old bridge\n");
    ok("failed: its extra file back", fs.existsSync(path.join(p.pkg, "bridge", "old-only.js")));
    same("failed: version.json as it was", read(path.join(p.pkg, "version.json")), before);
    same("failed: the old tar back", read(path.join(p.pkg, "images", "mtg-images.tar")), "old tar");
    same("failed: the old images loaded again, the bridge started", effects(p), ["stop-bridge", "reload", "load-images", "start-bridge", "reload", "load-images", "start-bridge"]);
    ok("failed: no backup left behind (it went back)", !fs.existsSync(path.join(p.pkg, "backup", "v1")));
    ok("failed: the download kept for another try", fs.existsSync(path.join(p.pkg, "updates", "v8", "app.zip")));
    fs.writeFileSync(p.fx, "");
    const r2 = await run(p, ["--update-now", "--fake-effects", p.fx, "--fake-fail", "load-images"]);
    ok("failed images: undone", r2.code === 1 && r2.out.includes("loading the new engine images didn't work"), JSON.stringify(r2));
    same("failed images: the old tar back", read(path.join(p.pkg, "images", "mtg-images.tar")), "old tar");
    ok("failed images: the new tar back in the download folder for another try", fs.readFileSync(path.join(p.pkg, "updates", "v8", "images.tar")).equals(tar));
    same("failed images: version.json and deployed.json as they were", [read(path.join(p.pkg, "version.json")), json(path.join(p.pkg, "stack", "deployed.json"))], [before, { bridge: "b1", nodeConfig: "sha256:this-pc" }]);
  }

  // 7b. a new table whose install fails: undone, version.json too
  {
    reset();
    publish("v8t", { app: unchanged("app"), table: { version: "s2", body: zipOf({ "table/MTG Table.json": "new table" }) }, images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v8t";
    const p = makePkg();
    const before = snapshot(p.pkg);
    const r = await run(p, ["--update-now", "--fake-effects", p.fx, "--fake-fail", "install-save"]);
    ok("failed table: undone, exit 1", r.code === 1 && r.out.includes("installing the new table didn't work"), JSON.stringify(r));
    same("failed table: the save install was tried, then the bridge started", effects(p), ["stop-bridge", "reload", "install-save", "reload", "start-bridge"]);
    const after = snapshot(p.pkg);
    for (const k of Object.keys(after)) if (k.startsWith("updates/")) delete after[k];
    same("failed table: the package exactly as it was (version.json too)", after, before);
  }

  // 7c. a new runtime (node.exe)
  {
    reset();
    publish("v8r", { app: unchanged("app"), table: unchanged("table"), images: unchanged("images"), runtime: { version: "v24.9.0", body: zipOf({ "runtime/node/node.exe": "new node" }) }, companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v8r";
    const p = makePkg();
    const r = await now(p);
    ok("new runtime: updated", r.code === 0 && r.out.includes("Updated to v8r"), JSON.stringify(r));
    same("new runtime: the new node.exe", read(path.join(p.pkg, "runtime", "node", "node.exe")), "new node");
    same("new runtime: version.json says so", json(path.join(p.pkg, "version.json")).parts.runtime, "v24.9.0");
  }

  // 7d. a move that fails half way (a file in decks\ held open, no delete sharing): nothing that wasn't moved is touched
  {
    reset();
    publish("v8h", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v8h";
    const p = makePkg();
    for (const [rel, text] of [["LICENSES/x.txt", "lic"], ["manabrew/public/preset_decks/m.json", "{}"]]) { fs.mkdirSync(path.dirname(path.join(p.pkg, rel)), { recursive: true }); fs.writeFileSync(path.join(p.pkg, rel), text); }
    const before = snapshot(p.pkg);
    const held = path.join(p.pkg, "decks", "a.json");
    const ps = helperPs(`$f=[System.IO.File]::Open('${held}','Open','Read','Read'); Write-Output held; Start-Sleep 30; $f.Close()`, ["ignore", "pipe", "ignore"]);
    await new Promise((res) => ps.stdout.once("data", res));
    const r = await now(p);
    ps.kill();
    await wait(() => ps.exitCode !== null, 5000);
    ok("held file: failed and undone, exit 1", r.code === 1 && r.out.includes("The update failed and was undone") && !r.out.includes("couldn't be put back"), JSON.stringify(r));
    const after = snapshot(p.pkg);
    for (const k of Object.keys(after)) if (k.startsWith("updates/")) delete after[k];
    same("held file: every file exactly as it was (decks, manabrew, LICENSES, version.json included)", after, before);
    ok("held file: no journal, no backup left", !fs.existsSync(path.join(p.pkg, "update-journal.json")) && !fs.existsSync(path.join(p.pkg, "backup", "v1")));
    const dump = path.join(ROOT, "dump-held.txt");
    const d = await run(p, ["--observe", "--dump", dump, "--steps", "0"]);
    ok("held file: the package still starts (observe finds it)", d.code === 0 && fs.existsSync(dump), JSON.stringify(d));
  }

  // 7e. killed mid-install (a power cut, Task Manager): the next start finishes or undoes it, before reading the package
  {
    reset();
    const tar = Buffer.from("killed images tar ".repeat(100));
    publish("v8k", { app: unchanged("app"), table: unchanged("table"), images: { version: "i8k", body: tar }, runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v8k";
    const p = makePkg();
    const before = snapshot(p.pkg);
    const r = await run(p, ["--update-now", "--fake-effects", p.fx, "--test-die-at", "place"]);
    ok("killed: the install died (no result line)", !r.out.includes("Updated to") && !r.out.includes("undone"), JSON.stringify(r));
    ok("killed: version.json is in the backup, not the package", !fs.existsSync(path.join(p.pkg, "version.json")) && fs.existsSync(path.join(p.pkg, "update-journal.json")));
    server.latest = "v1x"; addRelease("v1x", {}); // (the next start's check finds nothing new)
    const next = await run(p, ["--update-check"]);
    ok("killed: the next start undoes it and says so", next.out.includes("The update to v8k was interrupted, so it was undone"), JSON.stringify(next));
    const after = snapshot(p.pkg);
    for (const k of Object.keys(after)) if (k.startsWith("updates/")) delete after[k];
    same("killed: every file exactly as it was", after, before);
    ok("killed: the downloaded tar back in the download folder", fs.readFileSync(path.join(p.pkg, "updates", "v8k", "images.tar")).equals(tar));
    ok("killed: no journal, no backup", !fs.existsSync(path.join(p.pkg, "update-journal.json")) && !fs.existsSync(path.join(p.pkg, "backup", "v1")));
    server.latest = "v8k"; server.requests = [];
    const again = await now(p);
    ok("killed: then it installs without downloading again", again.code === 0 && again.out.includes("Updated to v8k") && dl().length === 0, JSON.stringify([again, dl()]));
  }
  {
    reset();
    publish("v8m", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v8m";
    const p = makePkg();
    const before = snapshot(p.pkg);
    await run(p, ["--update-now", "--fake-effects", p.fx, "--test-die-at", "move"]);
    ok("killed after one move: the bridge is in the backup", !fs.existsSync(path.join(p.pkg, "bridge")) && fs.existsSync(path.join(p.pkg, "update-journal.json")));
    const next = await run(p, ["--update-check"]);
    ok("killed after one move: undone at the next start", next.out.includes("was interrupted, so it was undone"), JSON.stringify(next));
    const after = snapshot(p.pkg);
    for (const k of Object.keys(after)) if (k.startsWith("updates/")) delete after[k];
    same("killed after one move: every file exactly as it was", after, before);
  }
  {
    reset();
    publish("v8p", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: { version: "i8p", body: Buffer.from("placed tar ".repeat(50)) }, runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v8p";
    const p = makePkg();
    await run(p, ["--update-now", "--fake-effects", p.fx, "--test-die-at", "placed"]);
    const next = await run(p, ["--update-check"]);
    ok("killed with every file in place: finished at the next start", next.out.includes("was interrupted after its files were in place") && next.out.includes("Up to date (v8p)"), JSON.stringify(next));
    same("killed with every file in place: the new bridge", read(path.join(p.pkg, "bridge", "bridge.js")), "// new bridge\n");
    ok("killed with every file in place: no journal", !fs.existsSync(path.join(p.pkg, "update-journal.json")));
    ok("killed with every file in place: the tar was moved into images\\, not copied", read(path.join(p.pkg, "images", "mtg-images.tar")) === "placed tar ".repeat(50) && !fs.existsSync(path.join(p.pkg, "updates", "v8p", "images.tar")));
  }

  // 7g. an undo that can't delete a new file (held open): that path is reported once, its old one stays in the backup,
  // the journal stays, and the next start finishes the undo
  {
    reset();
    publish("v8s", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v8s";
    const p = makePkg();
    const before = snapshot(p.pkg);
    await run(p, ["--update-now", "--fake-effects", p.fx, "--test-die-at", "place"]);
    ok("stuck undo: killed with the new bridge placed", read(path.join(p.pkg, "bridge", "bridge.js")) === "// new bridge\n" && fs.existsSync(path.join(p.pkg, "update-journal.json")));
    const held = path.join(p.pkg, "bridge", "bridge.js");
    const ps = helperPs(`$f=[System.IO.File]::Open('${held}','Open','Read','Read'); Write-Output held; Start-Sleep 60; $f.Close()`, ["ignore", "pipe", "ignore"]);
    await new Promise((res) => ps.stdout.once("data", res));
    server.latest = "v1x";
    const next = await run(p, ["--update-check"]);
    ps.kill();
    await wait(() => ps.exitCode !== null, 5000);
    const m = /These couldn't be put back: ([^.]*)\./.exec(next.out);
    const names = m ? m[1].split(", ") : [];
    ok("stuck undo: says what couldn't be put back, each path once", names.length > 0 && names.includes("bridge") && new Set(names).size === names.length, JSON.stringify(next));
    ok("stuck undo: the journal and the old bridge in the backup stay", fs.existsSync(path.join(p.pkg, "update-journal.json")) && read(path.join(p.pkg, "backup", "v1", "bridge", "bridge.js")) === "// old bridge\n");
    const again = await run(p, ["--update-check"]);
    ok("stuck undo: the next start finishes it", again.out.includes("was interrupted, so it was undone") && !fs.existsSync(path.join(p.pkg, "update-journal.json")), JSON.stringify(again));
    const after = snapshot(p.pkg);
    for (const k of Object.keys(after)) if (k.startsWith("updates/")) delete after[k];
    same("stuck undo: then every file exactly as it was", after, before);
  }

  // 7f. another MTG Companion holds the update mutex: no recovery and no second install meanwhile
  {
    reset();
    publish("v8x", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v8x";
    const p = makePkg();
    await run(p, ["--update-now", "--fake-effects", p.fx, "--test-die-at", "move"]);
    const ps = helperPs("$m = New-Object System.Threading.Mutex($false, 'Local\\MtgTtsCompanionUpdate'); [void]$m.WaitOne(); Write-Output held; Start-Sleep 30; $m.ReleaseMutex()", ["ignore", "pipe", "ignore"]);
    await new Promise((res) => ps.stdout.once("data", res));
    const busy = await run(p, ["--update-check"]);
    ok("mutex held: the start leaves the journal alone", !busy.out.includes("interrupted") && fs.existsSync(path.join(p.pkg, "update-journal.json")), JSON.stringify(busy));
    const q = makePkg();
    const second = await now(q);
    ok("mutex held: a second install refuses", second.code === 1 && second.out.includes("Another update is being installed"), JSON.stringify(second));
    same("mutex held: the second package untouched", read(path.join(q.pkg, "bridge", "bridge.js")), "// old bridge\n");
    ps.kill();
    await wait(() => ps.exitCode !== null, 5000);
    const next = await run(p, ["--update-check"]);
    ok("mutex free again: the journal is undone", next.out.includes("was interrupted, so it was undone") && read(path.join(p.pkg, "bridge", "bridge.js")) === "// old bridge\n", JSON.stringify(next));
  }

  // 7h. an undo that couldn't put runtime\ back (the old node.exe in the backup held, as an antivirus would): the
  // package has no runtime\, the journal and backup\v1 hold it. A new install never writes its journal over that one:
  // it finishes the old undo first, or refuses
  {
    reset();
    publish("v8n", { app: unchanged("app"), table: unchanged("table"), images: unchanged("images"), runtime: { version: "v24.9.1", body: zipOf({ "runtime/node/node.exe": "newer node" }) }, companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v8n";
    const p = makePkg();
    const journal = path.join(p.pkg, "update-journal.json"), oldNode = path.join(p.pkg, "backup", "v1", "runtime", "node", "node.exe");
    await run(p, ["--update-now", "--fake-effects", p.fx, "--test-die-at", "place"]);
    ok("left journal: killed with the old runtime in the backup", fs.existsSync(journal) && read(oldNode) === "old node");
    const ps = helperPs(`$f=[System.IO.File]::Open('${oldNode}','Open','Read','Read'); Write-Output held; Start-Sleep 90; $f.Close()`, ["ignore", "pipe", "ignore"]);
    await new Promise((res) => ps.stdout.once("data", res));
    const stuck = await run(p, ["--update-check"]);
    ok("left journal: the start's undo can't put runtime back, says so", /These couldn't be put back: [^.]*runtime/.test(stuck.out) && fs.existsSync(journal) && !fs.existsSync(path.join(p.pkg, "runtime")), JSON.stringify(stuck));
    const journalBefore = fs.readFileSync(journal);
    fs.writeFileSync(p.fx, "");
    const r = await now(p);
    ok("left journal: a new install is refused with a clear line, exit 1", r.code === 1 && r.out.includes("Not installing v8n: an earlier update isn't fully undone yet") && /couldn't be put back: [^.]*runtime/.test(r.out), JSON.stringify(r));
    ok("left journal: the old journal is not written over", fs.readFileSync(journal).equals(journalBefore), read(journal));
    ok("left journal: the old runtime still in backup\\v1, no second backup, nothing placed", read(oldNode) === "old node" && fs.readdirSync(path.join(p.pkg, "backup")).join() === "v1" && !fs.existsSync(path.join(p.pkg, "runtime")), tree(p.pkg).join(","));
    same("left journal: the bridge stopped for the undo and started again", effects(p), ["stop-bridge", "reload", "start-bridge"]);
    ok("left journal: the refusal is the last result (the page's line)", (json(path.join(p.state, "updates.json")).lastResult || "").includes("isn't fully undone"), read(path.join(p.state, "updates.json")));
    // the companion-first path too: refused before the new exe is put anywhere
    const firstExe = Buffer.concat([fs.readFileSync(EXE), Buffer.from(`\0FIRST-LEFT-${Date.now()}`)]);
    publish("v8c", { app: unchanged("app"), table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: { version: "c2", body: firstExe } }, { previous: v1Manifest });
    server.latest = "v8c";
    fs.writeFileSync(p.fx, "");
    const cf = await run(p, ["--update-now", "--fake-effects", p.fx, "--test-format", "0"]);
    ok("left journal, companion first: refused before the swap", cf.code === 1 && cf.out.includes("Not installing v8c: an earlier update isn't fully undone yet"), JSON.stringify(cf));
    ok("left journal, companion first: no new exe, the exe and the journal untouched", !fs.existsSync(path.join(p.pkg, "MTG Companion.new.exe")) && fs.readFileSync(path.join(p.pkg, "MTG Companion.exe")).equals(fs.readFileSync(EXE)) && fs.readFileSync(journal).equals(journalBefore));
    server.latest = "v8n";
    ps.kill();
    await wait(() => ps.exitCode !== null, 5000);
    // the file free again, and the start's own recovery skipped: the install itself finishes the old undo, then installs
    fs.writeFileSync(p.fx, "");
    const r2 = await run(p, ["--update-now", "--fake-effects", p.fx, "--test-skip-recover"]);
    ok("left journal, file free: the install undoes the old one first, then installs", r2.code === 0 && r2.out.includes("Updated to v8n") && !r2.out.includes("was interrupted") && /an earlier update was finished first/.test(read(p.log) || ""), JSON.stringify(r2));
    ok("left journal, file free: the new runtime, the old one in the (new) backup, no journal", read(path.join(p.pkg, "runtime", "node", "node.exe")) === "newer node" && read(oldNode) === "old node" && !fs.existsSync(journal), tree(p.pkg).join(","));
    same("left journal, file free: stopped for the undo, then the install's own steps", effects(p), ["stop-bridge", "reload", "stop-bridge", "reload", "start-bridge"]);
  }

  // 7i. the earlier update finished inside the install, then the new journal can't be written: nothing changed, and
  // the bridge the install stopped for that undo is started again
  {
    reset();
    publish("v8w", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v8w";
    const p = makePkg();
    const journal = path.join(p.pkg, "update-journal.json");
    await run(p, ["--update-now", "--fake-effects", p.fx, "--test-die-at", "move"]);
    ok("journal unwritable: killed after one move", fs.existsSync(journal) && !fs.existsSync(path.join(p.pkg, "bridge")));
    fs.writeFileSync(p.fx, "");
    const r = await run(p, ["--update-now", "--fake-effects", p.fx, "--test-skip-recover", "--test-journal-fail"]);
    ok("journal unwritable after an undo: says nothing was changed, exit 1", r.code === 1 && r.out.includes("its journal can't be written") && r.out.includes("Nothing was changed"), JSON.stringify(r));
    same("journal unwritable after an undo: the bridge the install stopped is started again", effects(p), ["stop-bridge", "reload", "start-bridge"]);
    ok("journal unwritable after an undo: the old bridge back, no journal", read(path.join(p.pkg, "bridge", "bridge.js")) === "// old bridge\n" && !fs.existsSync(journal));
    const q = makePkg();
    const plain = await run(q, ["--update-now", "--fake-effects", q.fx, "--test-journal-fail"]);
    ok("journal unwritable, no earlier update: refused, the bridge never touched", plain.code === 1 && plain.out.includes("Nothing was changed") && effects(q).length === 0, JSON.stringify([plain, effects(q)]));
  }

  // 7j. the earlier update finished inside the install, and the plan made again refuses (an older release): the bridge
  // stopped for the undo is started again
  {
    reset();
    publish("v8q", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v8q";
    const p = makePkg();
    const journal = path.join(p.pkg, "update-journal.json");
    await run(p, ["--update-now", "--fake-effects", p.fx, "--test-die-at", "move"]);
    publish("v8o", { app: { version: "a0", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest, built: "2026-10-01T09:00:00.000Z" });
    server.latest = "v8o";
    const c = await run(p, ["--update-check", "--test-skip-recover"]);
    ok("re-plan refusal: the check refuses the older release, the journal still there", c.out.includes("older than this package") && fs.existsSync(journal), JSON.stringify(c));
    fs.writeFileSync(p.fx, "");
    const r = await run(p, ["--update-now", "--fake-effects", p.fx, "--apply-update", "v8o", "--test-skip-recover"]);
    ok("re-plan refusal: the earlier update undone, then the older release refused", r.code === 1 && r.out.includes("The latest release (v8o) is older") && !fs.existsSync(journal) && read(path.join(p.pkg, "bridge", "bridge.js")) === "// old bridge\n", JSON.stringify(r));
    same("re-plan refusal: the bridge started again", effects(p), ["stop-bridge", "reload", "start-bridge"]);
  }

  // 7k. an undo that couldn't put version.json back (the new one held): the install doesn't judge the release by the
  // half-restored package ("Up to date" from the new version.json); it tries the undo and says what is stuck
  {
    reset();
    publish("v8u", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v8u";
    const p = makePkg();
    const journal = path.join(p.pkg, "update-journal.json"), vf = path.join(p.pkg, "version.json");
    await run(p, ["--update-now", "--fake-effects", p.fx, "--test-die-at", "written"]);
    ok("new version.json left: killed with the new version.json in place", fs.existsSync(journal) && json(vf).release === "v8u");
    const ps = helperPs(`$f=[System.IO.File]::Open('${vf}','Open','Read','Read'); Write-Output held; Start-Sleep 60; $f.Close()`, ["ignore", "pipe", "ignore"]);
    await new Promise((res) => ps.stdout.once("data", res));
    fs.writeFileSync(p.fx, "");
    const r = await run(p, ["--update-now", "--fake-effects", p.fx, "--apply-update", "v8u"]);
    ps.kill();
    await wait(() => ps.exitCode !== null, 5000);
    ok("new version.json left: the undo is tried and its own message shown, not 'Up to date'", r.code === 1 && r.out.includes("Not installing v8u: an earlier update isn't fully undone yet") && /couldn't be put back: [^.]*version\.json/.test(r.out) && !r.out.includes("Up to date"), JSON.stringify(r));
    ok("new version.json left: the journal stays", fs.existsSync(journal));
    fs.writeFileSync(p.fx, "");
    const r2 = await run(p, ["--update-now", "--fake-effects", p.fx, "--apply-update", "v8u", "--test-skip-recover"]);
    ok("new version.json left, file free: undone first, then installed", r2.code === 0 && r2.out.includes("Updated to v8u") && read(path.join(p.pkg, "bridge", "bridge.js")) === "// new bridge\n" && !fs.existsSync(journal), JSON.stringify(r2));
  }

  // 8. a new companion: the new exe takes the old one's name
  {
    reset();
    const newExe = Buffer.concat([fs.readFileSync(EXE), Buffer.from(`\0NEW-COMPANION-${Date.now()}`)]); // (an overlay: still runs)
    publish("v9", { app: unchanged("app"), table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: { version: "c2", body: newExe } }, { previous: v1Manifest });
    server.latest = "v9";
    const p = makePkg();
    const r = await now(p);
    ok("self-update: the new companion takes over", r.code === 0 && r.out.includes("the new MTG Companion takes over"), JSON.stringify(r));
    same("self-update: only the exe downloaded", dl(), ["v9/MTG.Companion.exe"]);
    const swapped = await wait(() => { try { return fs.readFileSync(path.join(p.pkg, "MTG Companion.exe")).equals(newExe) && fs.existsSync(path.join(p.pkg, "MTG Companion.old.exe")); } catch { return false; } });
    ok("self-update: MTG Companion.exe is the new one, the old kept as .old.exe", swapped, read(p.log)?.split("\n").filter((l) => l.includes("swap")).join(" | "));
    ok("self-update: no .new.exe left", await wait(() => !fs.existsSync(path.join(p.pkg, "MTG Companion.new.exe")), 5000));
    await wait(() => json(path.join(p.pkg, "version.json")).parts.companion === "c2", 5000);
    same("self-update: version.json has the new companion", json(path.join(p.pkg, "version.json")).parts.companion, "c2");
    same("self-update: the old app never starts the bridge (its loop would hold the exe being swapped)", effects(p), ["stop-bridge", "reload"]);
    ok("self-update: the old exe is the old bytes", fs.existsSync(path.join(p.pkg, "MTG Companion.old.exe")) && fs.readFileSync(path.join(p.pkg, "MTG Companion.old.exe")).equals(fs.readFileSync(EXE)));
    const next = await run(p, ["--update-check"]);
    ok("self-update: the next start is up to date", next.code === 0 && next.out.includes("Up to date (v9)"), JSON.stringify(next));
    ok("self-update: and removes the .old.exe", !fs.existsSync(path.join(p.pkg, "MTG Companion.old.exe")));
  }

  // 8a. a release this app can't apply (--test-format 0: minCompanion is newer): the new companion first, then it
  // applies the rest from the download, without checking again
  {
    reset();
    const newExe = Buffer.concat([fs.readFileSync(EXE), Buffer.from(`\0FIRST-${Date.now()}`)]);
    publish("v9f", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: { version: "c2", body: newExe } }, { previous: v1Manifest });
    server.latest = "v9f";
    const p = makePkg();
    const r = await run(p, ["--update-now", "--fake-effects", p.fx, "--test-format", "0"]);
    ok("companion first: the new companion takes over", r.code === 0 && r.out.includes("the new MTG Companion takes over"), JSON.stringify(r));
    ok("companion first: the new one applies the app", await wait(() => read(path.join(p.pkg, "bridge", "bridge.js")) === "// new bridge\n" && !fs.existsSync(path.join(p.pkg, "updates", "v9f"))), read(p.log));
    const v = json(path.join(p.pkg, "version.json"));
    same("companion first: both parts recorded", [v.parts.app, v.parts.companion], ["a2", "c2"]);
    same("companion first: releases/latest asked once (the rest came from the download, --apply-update)", latestHits(), 1);
  }

  // 8b. a new app and companion, but the new exe can't be put in place: the app is in, the companion stays old
  {
    reset();
    const newExe = Buffer.concat([fs.readFileSync(EXE), Buffer.from("\0NEW-BUT-BLOCKED")]);
    publish("v9b", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: { version: "c2", body: newExe } }, { previous: v1Manifest });
    server.latest = "v9b";
    const p = makePkg();
    fs.mkdirSync(path.join(p.pkg, "MTG Companion.new.exe")); // (a folder in the way: the copy fails)
    const r = await now(p);
    ok("blocked swap: says this one carries on, exit 1", r.code === 1 && r.out.includes("this one carries on"), JSON.stringify(r));
    const v = json(path.join(p.pkg, "version.json"));
    same("blocked swap: the app updated, the companion's version still the old one", [v.parts.app, v.parts.companion], ["a2", "c1"]);
    ok("blocked swap: the exe untouched", fs.readFileSync(path.join(p.pkg, "MTG Companion.exe")).equals(fs.readFileSync(EXE)));
    same("blocked swap: the bridge started once, after the swap failed (this app carries on)", effects(p), ["stop-bridge", "reload", "start-bridge"]);
    fs.rmdirSync(path.join(p.pkg, "MTG Companion.new.exe"));
    const again = await run(p, ["--update-check"]);
    ok("blocked swap: the next check offers the companion alone", again.code === 10 && again.out.includes("(this app;"), JSON.stringify(again));
  }

  // 8c. the swap waits for the old app by its pid AND start time: a pid now used by another process isn't waited
  // for; the old app itself still running after a minute means no swap (exit 1, both exes as they were)
  {
    const ps = helperPs("$p = Get-Process -Id $PID; Write-Output (\"$PID \" + $p.StartTime.ToUniversalTime().Ticks); Start-Sleep 150", ["ignore", "pipe", "ignore"]);
    let line = "";
    ps.stdout.on("data", (d) => { line += d; });
    await wait(() => /^\d+ \d+/.test(line), 20000);
    const [pid, ticks] = line.trim().split(" ");
    const swap = (p, oldStart) => new Promise((done) => {
      const newExe = path.join(p.pkg, "MTG Companion.new.exe");
      fs.writeFileSync(newExe, Buffer.concat([fs.readFileSync(EXE), Buffer.from("\0SWAP-" + oldStart)]));
      const t0 = Date.now();
      const child = spawn(newExe, ["--replace-old", pid, path.join(p.pkg, "MTG Companion.exe"), "--old-start", oldStart, "--part-version", "c2", "--then-exit", "--log", p.log], { stdio: "ignore" });
      const t = setTimeout(() => child.kill(), 120000);
      child.on("exit", (code) => { clearTimeout(t); done({ code, s: (Date.now() - t0) / 1000 }); });
    });
    const p = makePkg();
    const other = await swap(p, String(BigInt(ticks) - 600000000n)); // (started a minute earlier: another process)
    ok("swap: a pid reused by another process isn't waited for", other.code === 0 && other.s < 30, JSON.stringify(other));
    ok("swap: ... and the swap happened", !fs.readFileSync(path.join(p.pkg, "MTG Companion.exe")).equals(fs.readFileSync(EXE)) && fs.existsSync(path.join(p.pkg, "MTG Companion.old.exe")));
    const q = makePkg();
    const same1 = await swap(q, ticks);
    ok("swap: the old app still running after a minute: no swap, exit 1", same1.code === 1 && same1.s >= 55, JSON.stringify(same1));
    ok("swap: ... the exe untouched", fs.readFileSync(path.join(q.pkg, "MTG Companion.exe")).equals(fs.readFileSync(EXE)) && !fs.existsSync(path.join(q.pkg, "MTG Companion.old.exe")));
    ok("swap: ... and the log says why", (read(q.log) || "").includes("still running after 60 s"));
    ps.kill();
  }

  // 8d. --update-base off this PC (or https): refused outright, exit 2 (a test server is only ever loopback http)
  {
    const p = makePkg();
    for (const bad of ["http://192.0.2.1:9", "https://127.0.0.1:9"]) {
      const r = await new Promise((done) => {
        const child = spawn(path.join(p.pkg, "MTG Companion.exe"), ["--update-check", "--update-base", bad, "--state", p.state, "--log", p.log], { stdio: ["ignore", "pipe", "pipe"] });
        let out = ""; child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
        const t = setTimeout(() => child.kill(), 60000);
        child.on("exit", (code) => { clearTimeout(t); done({ code, out: out.trim() }); });
      });
      ok(`bad test base ${bad}: refused, exit 2`, r.code === 2 && r.out.includes("--update-base takes only"), JSON.stringify(r));
    }
  }

  // 9. an asset off GitHub's hosts: refused before any request
  {
    reset();
    publish("v10", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest, urls: { "app.zip": "https://example.com/evil/app.zip" } });
    server.latest = "v10";
    const p = makePkg();
    const r = await now(p);
    ok("off-host: refused, exit 1", r.code === 1 && r.out.includes("refused example.com: not a GitHub address"), JSON.stringify(r));
    same("off-host: nothing downloaded or done", [dl(), effects(p)], [[], []]);
  }

  // 9b. a redirect that leaves GitHub's hosts: refused at that hop
  {
    reset();
    publish("v10b", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v10b";
    server.redirectOff.add("v10b/app.zip");
    const p = makePkg();
    const r = await now(p);
    ok("off-host redirect: refused, exit 1", r.code === 1 && r.out.includes("refused example.com"), JSON.stringify(r));
    same("off-host redirect: nothing done", effects(p), []);
  }

  // 12. a zip that writes outside its part: refused and undone
  {
    reset();
    const evil = zipOf({ "bridge/bridge.js": "// evil bridge\n", "MTG Companion.exe": "not an exe" });
    publish("v12", { app: { version: "a2", body: evil }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v12";
    const p = makePkg();
    const exeBefore = fs.readFileSync(path.join(p.pkg, "MTG Companion.exe"));
    const r = await now(p);
    ok("zip outside its part: undone, exit 1", r.code === 1 && r.out.includes("which isn't the app part's"), JSON.stringify(r));
    ok("zip outside its part: the exe untouched", fs.readFileSync(path.join(p.pkg, "MTG Companion.exe")).equals(exeBefore));
    same("zip outside its part: the old bridge back", read(path.join(p.pkg, "bridge", "bridge.js")), "// old bridge\n");
  }

  // 12b. names Windows resolves elsewhere: a trailing space or dots ("bridge/.. /x" is "bridge/../x"), a stream
  for (const [i, evilName] of ["bridge/.. /escaped.txt", "bridge/.../escaped.txt", "bridge/... /escaped.txt", "bridge/.. /.. /escaped.txt", "bridge/bridge.js:stream"].entries()) {
    reset();
    const tag = `v12-${i}`;
    publish(tag, { app: { version: `a12-${i}`, body: rawZip({ "bridge/bridge.js": "// new bridge\n", [evilName]: "x" }) }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = tag;
    const p = makePkg();
    const r = await now(p);
    ok(`zip name "${evilName}": refused and undone`, r.code === 1 && r.out.includes("which isn't the app part's") && r.out.includes("undone"), JSON.stringify(r));
    ok(`zip name "${evilName}": nothing written outside bridge\\`, !fs.existsSync(path.join(p.pkg, "escaped.txt")) && !fs.existsSync(path.join(p.pkg, "..", "escaped.txt")) && !fs.existsSync(path.join(p.pkg, "bridge", "escaped.txt")), tree(p.pkg).join(","));
    same(`zip name "${evilName}": the old bridge back`, read(path.join(p.pkg, "bridge", "bridge.js")), "// old bridge\n");
  }

  // 12c. the manifest's signature: missing, another key's, or a manifest changed after signing: refused, nothing fetched
  for (const [sign, why] of [["none", "isn't signed"], ["other", "isn't signed by this project's release key"], ["tamper", "isn't signed by this project's release key"]]) {
    reset();
    const tag = `v12s-${sign}`;
    publish(tag, { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest, sign });
    server.latest = tag;
    const p = makePkg();
    const r = await now(p);
    ok(`signature ${sign}: refused with a clear line, exit 1`, r.code === 1 && r.out.includes(why) && r.out.includes("not used"), JSON.stringify(r));
    same(`signature ${sign}: nothing downloaded or done`, [dl(), effects(p)], [[], []]);
  }
  {
    reset();
    publish("v12v", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest, version: "v99" });
    server.latest = "v12v";
    const p = makePkg();
    const r = await now(p);
    ok("a signed manifest of another release: refused", r.code === 1 && r.out.includes("says v99 but sits in release v12v"), JSON.stringify(r));
    same("a signed manifest of another release: nothing downloaded", dl(), []);
  }

  // 12g. downgrades: "latest" moved back to an older, validly signed release is refused and not offered; the same
  // build (its time written another way) is up to date; a newer one is offered; a package with no build time refuses
  {
    reset();
    const older = (k) => (k === "app" ? { version: "a0", body: newApp() } : unchanged(k));
    publish("v12o", Object.fromEntries(["app", "table", "images", "runtime", "companion"].map((k) => [k, older(k)])), { previous: v1Manifest, built: "2026-10-01T09:00:00.000Z" });
    server.latest = "v12o";
    const p = makePkg();
    const c = await run(p, ["--update-check"]);
    ok("older release: not offered, says so", c.code === 0 && c.out.includes("The latest release (v12o) is older than this package; not installing it."), JSON.stringify(c));
    const r = await now(p);
    ok("older release: --update-now doesn't install it", r.code === 0 && r.out.includes("older than this package") && !r.out.includes("Updated"), JSON.stringify(r));
    same("older release: nothing downloaded or done", [dl(), effects(p)], [[], []]);
    same("older release: the bridge untouched", read(path.join(p.pkg, "bridge", "bridge.js")), "// old bridge\n");
    ok("older release: the last result says why (the page's line)", (json(path.join(p.state, "updates.json")).lastResult || "").includes("older than this package"), read(path.join(p.state, "updates.json")));
  }
  {
    reset();
    const all = (app) => Object.fromEntries(["app", "table", "images", "runtime", "companion"].map((k) => [k, k === "app" && app ? app : unchanged(k)]));
    publish("v12e", all(null), { previous: v1Manifest, built: "2026-11-01T10:00:00+01:00" }); // (the package's own build time)
    server.latest = "v12e";
    const p = makePkg();
    const c = await run(p, ["--update-check"]);
    ok("same build: up to date", c.code === 0 && c.out.includes("Up to date (v12e)"), JSON.stringify(c));
    publish("v12n", all({ version: "a2", body: newApp() }), { previous: v1Manifest, built: "2026-11-01T09:00:00.001Z" });
    server.latest = "v12n";
    const n = await run(p, ["--update-check"]);
    ok("a release a millisecond newer: offered", n.code === 10 && n.out.includes("Update available: v12n"), JSON.stringify(n));
    reset();
    const q = makePkg(BASE_PARTS, { built: undefined });
    const nb = await now(q);
    ok("a package with no build time: refused (fail safe), nothing downloaded", nb.code === 0 && nb.out.includes("has no build time") && dl().length === 0 && effects(q).length === 0, JSON.stringify(nb));
  }

  // 12h. a stale offer: a release checked (and offered) against the package as it was, then a newer build installed
  // while it downloads (a pending update after a game, a second window): the install plans again and refuses it
  {
    reset();
    const parts = Object.fromEntries(["app", "table", "images", "runtime", "companion"].map((k) => [k, k === "app" ? { version: "a2", body: newApp() } : unchanged(k)]));
    publish("v12x", parts, { previous: v1Manifest, built: "2026-11-05T09:00:00.000Z" });
    server.latest = "v12x";
    const p = makePkg();
    const h = holdDl("v12x/app.zip");
    const running = now(p);
    await h.asked;
    const vf = path.join(p.pkg, "version.json"), v = json(vf);
    fs.writeFileSync(vf, JSON.stringify({ ...v, built: "2026-11-10T12:00:00.000Z", release: "v12y", parts: { ...v.parts, app: "a3" } })); // (v12y installed meanwhile)
    h.release();
    const r = await running;
    ok("stale offer: offered first (the check saw the old package)", r.out.includes("Update available: v12x"), JSON.stringify(r));
    ok("stale offer: refused at the install, the package newer now", r.code === 1 && r.out.includes("The latest release (v12x) is older than this package") && !r.out.includes("Updated"), JSON.stringify(r));
    same("stale offer: nothing done, the bridge untouched", [effects(p), read(path.join(p.pkg, "bridge", "bridge.js"))], [[], "// old bridge\n"]);  }

  // 12e. a download that runs past the part's size: reading stops there, the file is refused
  {
    reset();
    publish("v12f", { app: unchanged("app"), table: unchanged("table"), images: { version: "i12f", body: Buffer.from("small tar ".repeat(100)) }, runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v12f";
    server.flood.add("v12f/images.tar");
    const p = makePkg();
    const r = await now(p);
    ok("oversized download: refused, exit 1", r.code === 1 && r.out.includes("didn't match the release's checksum"), JSON.stringify(r));
    const sent = server.floodSent["v12f/images.tar"] || 0;
    ok("oversized download: the reading stopped near the part's size, not at 64 MB", sent > 0 && sent < 24 * 1048576, `server sent ${(sent / 1048576).toFixed(1)} MB`);
    same("oversized download: nothing done", effects(p), []);
  }

  // 12d. a 206 that doesn't continue the partial file: started again from 0, not appended
  {
    reset();
    const tar = Buffer.from("range images tar ".repeat(5000));
    publish("v12r", { app: unchanged("app"), table: unchanged("table"), images: { version: "i12r", body: tar }, runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v12r";
    server.cutOnce.add("v12r/images.tar"); server.badRange.add("v12r/images.tar");
    const p = makePkg();
    const r = await now(p);
    ok("bad Content-Range: started again and installed", r.code === 0 && r.out.includes("Updated to v12r"), JSON.stringify(r));
    ok("bad Content-Range: the tar is whole", fs.readFileSync(path.join(p.pkg, "images", "mtg-images.tar")).equals(tar));
    ok("bad Content-Range: no 'refused' in the log", !/refused/i.test((read(p.log) || "").split("\n").filter((l) => l.includes("images.tar")).join("\n")) && /starting again from 0/.test(read(p.log) || ""), read(p.log));
  }

  // 13. three updates in a row: the last 2 backups kept
  {
    const p = makePkg();
    for (const [i, tag] of ["v13", "v14", "v15"].entries()) {
      reset();
      publish(tag, { app: { version: `a${3 + i}`, body: newApp() }, table: unchanged("table"), images: { version: `i${13 + i}`, body: Buffer.from(`tar ${tag}`) }, runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
      server.latest = tag;
      const r = await now(p);
      ok(`backups: ${tag} applied`, r.code === 0, JSON.stringify(r));
      await new Promise((done) => setTimeout(done, 50)); // (creation times apart)
    }
    same("backups: the last 2 kept", fs.readdirSync(path.join(p.pkg, "backup")).sort(), ["v13", "v14"]);
    same("backups: the engine images only in the newest", [fs.existsSync(path.join(p.pkg, "backup", "v13", "images")), read(path.join(p.pkg, "backup", "v14", "images", "mtg-images.tar"))], [false, "tar v14"]);
  }

  // 10. the token: only to the API host, never in the log
  {
    reset();
    publish("v11", { app: { version: "a2", body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
    server.latest = "v11";
    const p = makePkg();
    const TOKEN = "github_pat_TEST0123456789abcdef";
    const t = await run(p, ["--set-token"], `${TOKEN}\n`);
    ok("token: saved", t.code === 0 && t.out.includes("token saved"), JSON.stringify(t));
    ok("token: not stored in plain text", !fs.readFileSync(path.join(p.state, "github-token.bin")).toString("latin1").includes(TOKEN));
    const r = await now(p);
    ok("token: the update works", r.code === 0, JSON.stringify(r));
    // (only api.github.com itself gets it: --selftest checks Updates.TokenFor; a test server never does)
    ok("token: never sent to a test server", server.requests.length >= 5 && server.requests.every((q) => q.auth === null), JSON.stringify(server.requests.map((q) => q.auth)));
    ok("token: never in the log", !(read(p.log) || "").includes(TOKEN) && !(read(path.join(p.state, "updates.json")) || "").includes(TOKEN));
    const rm = await run(p, ["--set-token"], "");
    ok("token: removed with an empty line", rm.out.includes("token removed") && !fs.existsSync(path.join(p.state, "github-token.bin")));
  }

  // 11. the packager's release plan: a part the previous release has is pointed at, not built
  {
    const prev = { version: "v1", parts: { app: { file: "app.zip", sha256: "a".repeat(64), size: 5, version: "a1", release: "v0" }, images: { file: "images.tar", sha256: "b".repeat(64), size: 9, version: "i1" } } };
    const plan = pack.planRelease({ app: "a1", images: "i1", table: "s2" }, prev);
    same("release plan: only the changed part built", plan.build, ["table"]);
    same("release plan: unchanged parts point at the release holding the file", [plan.reuse.app.release, plan.reuse.images.release], ["v0", "v1"]);
    same("release plan: no previous: all built", pack.planRelease({ app: "a1", images: "i1" }, null).build, ["app", "images"]);
    same("release plan: a changed images id builds the tar", pack.planRelease({ images: "i2" }, prev).build, ["images"]);
    const notPublished = pack.planRelease({ app: "a1", images: "i1" }, prev, { published: false, have: (rel, file) => rel === "v1" && file === "images.tar" });
    same("release plan: not the published manifest: a part reused only when its file is in dist with its sha", [notPublished.build, Object.keys(notPublished.reuse), notPublished.unproven], [["app"], ["images"], ["app"]]);
    let threw = false;
    try { pack.releaseManifest({ tag: "v2", partVersions: { app: "a2" }, made: {}, reuse: {} }); } catch { threw = true; }
    ok("release manifest: a part neither built nor carried is an error", threw);
    same("tree hash: path order, not listing order", pack.treeHash([{ rel: "b", bytes: "2" }, { rel: "a", bytes: "1" }]), pack.treeHash([{ rel: "a", bytes: "1" }, { rel: "b", bytes: "2" }]));
    ok("tree hash: a renamed file changes it", pack.treeHash([{ rel: "a", bytes: "1" }]) !== pack.treeHash([{ rel: "c", bytes: "1" }]));
  }
}

main().catch((e) => ok("run", false, e.stack)).finally(() => {
  srv.close();
  try { fs.rmSync(ROOT, { recursive: true, force: true }); } catch {}
  process.stdout.write(failed ? `\n${failed} companion update checks failed (${passed} passed)\n` : `all ${passed} companion update checks pass\n`);
  process.exit(failed ? 1 : 0);
});
