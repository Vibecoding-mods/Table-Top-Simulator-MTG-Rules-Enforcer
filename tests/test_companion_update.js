// The companion's self-update (docs/companion-app-spec.md §18) end to end: the built exe in a temp package against a
// fake GitHub (releases, assets with a redirect to a second host, Range, a first-try 500, a cut download) and a fake
// bridge /state. The bridge, Docker and save steps are written to a file (--fake-effects), so nothing real is touched:
// no Docker, no TTS saves, no live bridge (--bridge-url points at the fake).
//   node tests/test_companion_update.js        (builds companion\bin\MTG Companion.exe first when it is stale)
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn, execFileSync } = require("child_process");
const pack = require("../tools/make-friend-package");

const REPO = path.join(__dirname, "..");
const COMPANION = path.join(REPO, "companion");
const EXE = process.env.COMPANION_EXE || path.join(COMPANION, "bin", "MTG Companion.exe"); // (COMPANION_EXE: the mutation pass's build)
const TAR = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe");
const API = "/repos/Vibecoding-mods/Table-Top-Simulator-Mock-MTGA";
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
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
const RID = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
const NID = "sha256:2222222222222222222222222222222222222222222222222222222222222222";
const BASE_PARTS = { app: "a1", table: "s1", images: pack.imagesVersion(NID, RID), runtime: "v24.1.0", companion: "c1" };

// a package as v1 left it
let pkgN = 0;
function makePkg(parts = BASE_PARTS) {
  const pkg = path.join(ROOT, `pkg${++pkgN}`);
  const put = (rel, text) => { const p = path.join(pkg, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  put("version.json", JSON.stringify({ bridge: "b1", table: "t1", save: "s1", node: NID, relay: RID, built: "2026-11-01T09:00:00.000Z", release: "v1", nodeVersion: "v24.1.0", parts }));
  put("bridge/bridge.js", "// old bridge\n");
  put("bridge/old-only.js", "// gone after the update\n");
  put("decks/a.json", "{}");
  put("stack/compose.yml", "name: mtg-table\n");
  put("stack/deployed.json", JSON.stringify({ bridge: "b1" }));
  put("table/MTG Table.json", "old table");
  put("images/mtg-images.tar", "old tar");
  put("runtime/node/node.exe", "old node");
  put("README-FRIEND.txt", "old readme");
  fs.mkdirSync(path.join(pkg, "logs"), { recursive: true });
  fs.copyFileSync(EXE, path.join(pkg, "MTG Companion.exe"));
  return { pkg, state: path.join(pkg, "..", `state${pkgN}`), log: path.join(pkg, "logs", "companion.log"), fx: path.join(pkg, "..", `fx${pkgN}.txt`) };
}

// ── the fake GitHub

const server = { releases: {}, latest: null, latestStatus: 200, assets: {}, requests: [], game: false, failOnce: new Set(), cutOnce: new Set(), redirectOff: new Set() };
let PORT = 0, BASE = "";
const srv = http.createServer((req, res) => {
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
    if (server.failOnce.delete(key)) return send(500, "{}");
    const r = /^bytes=(\d+)-$/.exec(req.headers.range || "");
    const from = r ? Number(r[1]) : 0;
    if (from >= body.length) return send(416, "");
    res.writeHead(r ? 206 : 200, { "Content-Type": "application/octet-stream", "Content-Length": body.length - from, ...(r ? { "Content-Range": `bytes ${from}-${body.length - 1}/${body.length}` } : {}) });
    if (server.cutOnce.delete(key)) { res.write(body.subarray(from, from + Math.floor((body.length - from) / 2))); setTimeout(() => res.destroy(), 50); return; }
    return res.end(body.subarray(from));
  }
  send(404, "{}");
});
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

// a release whose parts are { part: { version, body } | { version, release } (carried by an older one) }
function publish(tag, parts, { previous = null, sha = {}, urls } = {}) {
  const partVersions = Object.fromEntries(Object.entries(parts).map(([k, p]) => [k, p.version]));
  const files = {}, made = {}, reuse = {};
  for (const [k, p] of Object.entries(parts)) {
    if (p.release) { reuse[k] = { ...previous.parts[k], release: p.release }; continue; }
    const file = pack.RELEASE_PARTS[k].file;
    files[file] = p.body;
    made[k] = { file, sha256: sha[k] || sha256(p.body), size: p.body.length };
  }
  const versionJson = { bridge: "b2", table: "t2", save: partVersions.table, node: NID, relay: RID, built: "2026-11-10T12:00:00.000Z", release: tag, parts: partVersions };
  const manifest = pack.releaseManifest({ tag, built: versionJson.built, gitCommit: "abc1234", partVersions, made, reuse, full: { file: "full.zip", sha256: "0".repeat(64), size: 1 }, versionJson, deployedJson: { bridge: "b2", table: "t2" } });
  files["update-manifest.json"] = Buffer.from(JSON.stringify(manifest));
  addRelease(tag, files, urls);
  return manifest;
}

// the exe, without waiting on the event loop (the fake server answers it)
function run(p, args, stdin) {
  return new Promise((done) => {
    const child = spawn(path.join(p.pkg, "MTG Companion.exe"), [...args, "--update-base", BASE, "--bridge-url", BASE, "--state", p.state, "--log", p.log], { stdio: ["pipe", "pipe", "pipe"] });
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
const dl = () => server.requests.filter((r) => r.path.startsWith("/dl/") && !r.path.endsWith("/update-manifest.json")).map((r) => r.path.replace(/^\/dl\//, ""));
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
    same("new app: deployed.json from the release", json(path.join(p.pkg, "stack", "deployed.json")), m.deployedJson);
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
    server.game = false; server.requests = [];
    const r2 = await now(p);
    ok("game over: installed", r2.code === 0 && r2.out.includes("Updated to v7"), JSON.stringify(r2));
    same("game over: not downloaded again", dl(), []);
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
    ok("self-update: the old exe is the old bytes", fs.existsSync(path.join(p.pkg, "MTG Companion.old.exe")) && fs.readFileSync(path.join(p.pkg, "MTG Companion.old.exe")).equals(fs.readFileSync(EXE)));
    const next = await run(p, ["--update-check"]);
    ok("self-update: the next start is up to date", next.code === 0 && next.out.includes("Up to date (v9)"), JSON.stringify(next));
    ok("self-update: and removes the .old.exe", !fs.existsSync(path.join(p.pkg, "MTG Companion.old.exe")));
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
    fs.rmdirSync(path.join(p.pkg, "MTG Companion.new.exe"));
    const again = await run(p, ["--update-check"]);
    ok("blocked swap: the next check offers the companion alone", again.code === 10 && again.out.includes("(this app;"), JSON.stringify(again));
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

  // 13. three updates in a row: the last 2 backups kept
  {
    const p = makePkg();
    for (const [i, tag] of ["v13", "v14", "v15"].entries()) {
      reset();
      publish(tag, { app: { version: `a${3 + i}`, body: newApp() }, table: unchanged("table"), images: unchanged("images"), runtime: unchanged("runtime"), companion: unchanged("companion") }, { previous: v1Manifest });
      server.latest = tag;
      const r = await now(p);
      ok(`backups: ${tag} applied`, r.code === 0, JSON.stringify(r));
      await new Promise((done) => setTimeout(done, 50)); // (creation times apart)
    }
    same("backups: the last 2 kept", fs.readdirSync(path.join(p.pkg, "backup")).sort(), ["v13", "v14"]);
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
    const apiReqs = server.requests.filter((q) => q.host === `127.0.0.1:${PORT}` && q.path.startsWith("/repos"));
    const assetReqs = server.requests.filter((q) => q.host === `localhost:${PORT}`);
    ok("token: sent to the API host", apiReqs.length >= 3 && apiReqs.every((q) => q.auth === `Bearer ${TOKEN}`), JSON.stringify(apiReqs.map((q) => q.auth)));
    ok("token: not to the asset host after the redirect", assetReqs.length >= 2 && assetReqs.every((q) => q.auth === null), JSON.stringify(assetReqs.map((q) => q.auth)));
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
