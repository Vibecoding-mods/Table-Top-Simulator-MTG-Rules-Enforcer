// tools/publish-release.js against a fake GitHub: never the network (global fetch is replaced by one that fails the
// test, and every call goes to a stub that records it), never the real token (a fake one in a temp folder; HOME and
// USERPROFILE point there before the module loads, so its default token path is the temp folder's too).
// Covers: a dry run reads no token and calls nothing; a new tag creates the release then uploads; a second run uploads
// only what is missing; a failed upload is counted and retried on the next run; the token is never printed and goes
// only to api.github.com and uploads.github.com; an upload address on another host is refused; bad folders refused.
//   node tests/test_publish_release.js
require("./no-live-ports");
const fs = require("fs");
const os = require("os");
const path = require("path");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "publish-release-"));
process.env.USERPROFILE = tmp;
process.env.HOME = tmp;
let netCalls = 0;
globalThis.fetch = async (url) => { netCalls++; throw new Error(`test_publish_release: a real fetch of ${url}`); };
const pub = require("../tools/publish-release");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${typeof why === "string" ? why : JSON.stringify(why)}` : ""}\n`); } };

const TOKEN = "fake_test_token_0123456789abcdef"; // (not a real token: the shape of none GitHub issues)
const tokenFile = path.join(tmp, "token.txt");
fs.writeFileSync(tokenFile, `${TOKEN}\n`);
const API = "https://api.github.com/repos/" + pub.REPO;

// a release folder: two files, one with a space, and the notes (never uploaded)
const dir = path.join(tmp, "release-v2099.01.01-0000");
fs.mkdirSync(dir);
fs.writeFileSync(path.join(dir, "MTG Companion.exe"), "exe bytes");
fs.writeFileSync(path.join(dir, "update.json"), "{}");
fs.writeFileSync(path.join(dir, "RELEASE-NOTES.md"), "the notes");
const extra = path.join(tmp, "MTG-Table-linux.tar.gz");
fs.writeFileSync(extra, "tar bytes");

// A fake GitHub: releases by tag, assets by name; fail: names whose upload answers 500 once
function fakeGitHub({ exists = false, uploadUrl = "https://uploads.github.com/repos/x/y/releases/7/assets{?name,label}", fail = [] } = {}) {
  const calls = [];
  let release = exists ? { id: 7, upload_url: uploadUrl, html_url: "https://github.com/x/y/releases/7", assets: [] } : null;
  const failing = new Set(fail);
  const reply = (status, body) => ({ status, text: async () => (body === undefined ? "" : JSON.stringify(body)) });
  const fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || "GET", auth: opts.headers && opts.headers.Authorization, body: opts.body });
    const u = new URL(url);
    if (u.hostname === "api.github.com" && url === `${API}/releases/tags/v2099.01.01-0000`) return release ? reply(200, release) : reply(404, { message: "Not Found" });
    if (u.hostname === "api.github.com" && url === `${API}/releases` && opts.method === "POST") {
      release = { id: 7, upload_url: uploadUrl, html_url: "https://github.com/x/y/releases/7", assets: [], sent: JSON.parse(opts.body) };
      return reply(201, release);
    }
    if (url.startsWith(uploadUrl.replace(/\{.*$/, "")) && opts.method === "POST") {
      const name = u.searchParams.get("name");
      if (failing.has(name)) { failing.delete(name); return reply(500, { message: "boom" }); }
      release.assets.push({ name, state: "uploaded" });
      return reply(201, { name });
    }
    return reply(418, { message: `unexpected ${url}` });
  };
  return { fetch, calls, get release() { return release; } };
}
const capture = () => { const lines = []; return { lines, log: (s) => lines.push(String(s)), write: (s) => lines.push(String(s)), text: () => lines.join("\n") }; };
const run = async (gh, argv, extraOpts = {}) => {
  const out = capture();
  let failedCount = null, error = null;
  try { failedCount = await pub.main({ argv, fetch: gh && gh.fetch, tokenFile, log: out.log, write: out.write, ...extraOpts }); } catch (e) { error = e.message; }
  return { out, failedCount, error };
};

(async () => {
  ok("setup: the module's default token path is in the temp folder", pub.TOKEN_FILE === path.join(tmp, ".mtg-release", "github-token.txt"), pub.TOKEN_FILE);

  // ── dry run: lists, reads no token, calls nothing
  {
    const gh = fakeGitHub();
    const r = await run(gh, ["--dir", dir, "--extra", extra, "--dry-run"], { tokenFile: path.join(tmp, "missing-token.txt") });
    ok("dry run: no error without a token file (it isn't read)", r.error === null, r.error);
    ok("dry run: no call at all", gh.calls.length === 0, gh.calls);
    ok("dry run: lists the three files, not the notes", /3 files/.test(r.out.text()) && !r.out.text().includes("RELEASE-NOTES"), r.out.lines);
  }

  // ── a new tag: created with the notes, then every file uploaded
  const gh = fakeGitHub();
  {
    const r = await run(gh, ["--dir", dir, "--extra", extra]);
    ok("new tag: no error, nothing failed", r.error === null && r.failedCount === 0, r);
    const create = gh.calls.find((c) => c.method === "POST" && c.url === `${API}/releases`);
    ok("new tag: the release is created for the folder's tag, with the notes", !!create && gh.release.sent.tag_name === "v2099.01.01-0000" && gh.release.sent.body === "the notes", gh.release && gh.release.sent);
    ok("new tag: all three files uploaded, a space as a dot", JSON.stringify(gh.release.assets.map((a) => a.name).sort()) === JSON.stringify(["MTG-Table-linux.tar.gz", "MTG.Companion.exe", "update.json"]), gh.release.assets);
    ok("new tag: the notes are never uploaded", !gh.release.assets.some((a) => /RELEASE-NOTES/.test(a.name)));
    ok("token: every call carries it, and only to GitHub's two hosts", gh.calls.length > 0 && gh.calls.every((c) => c.auth === `Bearer ${TOKEN}` && ["api.github.com", "uploads.github.com"].includes(new URL(c.url).hostname)), gh.calls.map((c) => c.url));
    ok("token: never printed", !r.out.text().includes(TOKEN) && !r.out.text().includes(TOKEN.slice(0, 12)), r.out.lines);
  }

  // ── run again: nothing new is uploaded
  {
    const before = gh.calls.length;
    const r = await run(gh, ["--dir", dir, "--extra", extra]);
    const uploads = gh.calls.slice(before).filter((c) => c.method === "POST");
    ok("again: no upload and no second release", r.error === null && r.failedCount === 0 && uploads.length === 0, uploads);
    ok("again: each file said as had", (r.out.text().match(/have {5}/g) || []).length === 3, r.out.lines);
  }

  // ── a failed upload: counted, said, and the next run uploads only it
  {
    const g2 = fakeGitHub({ exists: true, fail: ["update.json"] });
    const r = await run(g2, ["--dir", dir]);
    ok("a failed upload: counted (the exit code)", r.failedCount === 1 && /1 file\(s\) failed/.test(r.out.text()), r);
    const before = g2.calls.length;
    const r2 = await run(g2, ["--dir", dir]);
    const ups = g2.calls.slice(before).filter((c) => c.method === "POST").map((c) => new URL(c.url).searchParams.get("name"));
    ok("a failed upload: the next run uploads it alone", r2.failedCount === 0 && JSON.stringify(ups) === JSON.stringify(["update.json"]), ups);
  }

  // ── an upload address on another host: refused before the token is sent there
  {
    const g3 = fakeGitHub({ exists: true, uploadUrl: "https://uploads.example.org/repos/x/y/releases/7/assets{?name}" });
    const r = await run(g3, ["--dir", dir]);
    ok("upload host: another host is refused", /isn't on uploads\.github\.com/.test(r.error || ""), r.error);
    ok("upload host: the token never went there", !g3.calls.some((c) => new URL(c.url).hostname !== "api.github.com"), g3.calls.map((c) => c.url));
  }

  // ── refusals
  {
    const g4 = fakeGitHub();
    const other = path.join(tmp, "not-a-release");
    fs.mkdirSync(other);
    ok("a folder not named release-<tag> is refused, nothing called", /release-<tag>/.test((await run(g4, ["--dir", other])).error || "") && g4.calls.length === 0);
    ok("no --dir is refused", /--dir/.test((await run(g4, [])).error || ""));
    ok("an unknown argument is refused", /unknown argument/.test((await run(g4, ["--dir", dir, "--force"])).error || ""));
    ok("a missing --extra file is refused, nothing called", /extra file not found/.test((await run(g4, ["--dir", dir, "--extra", path.join(tmp, "nope.tar.gz")])).error || "") && g4.calls.length === 0);
    ok("no token file: refused, nothing called", /no token/.test((await run(g4, ["--dir", dir], { tokenFile: path.join(tmp, "missing-token.txt") })).error || "") && g4.calls.length === 0);
    const g5 = fakeGitHub();
    const g5fetch = g5.fetch;
    g5.fetch = async (url, o) => (url.includes("/releases/tags/") ? { status: 401, text: async () => "{}" } : g5fetch(url, o));
    ok("a refused read (401) stops it before any upload", /HTTP 401/.test((await run(g5, ["--dir", dir])).error || "") && g5.calls.length === 0);
  }

  ok("network: the real fetch was never called", netCalls === 0, netCalls);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
