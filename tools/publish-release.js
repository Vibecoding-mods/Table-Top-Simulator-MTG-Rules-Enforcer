#!/usr/bin/env node
// Publishes a built release to GitHub: creates the release for the tag (notes from RELEASE-NOTES.md) if it doesn't
// exist yet, then uploads every release file the release doesn't already have. Safe to run again: files already
// uploaded are skipped, so an interrupted upload is finished by running it a second time.
//
//   node tools/publish-release.js --dir dist/release-<tag> [--extra file ...] [--dry-run]
//
// The tag is the folder name after "release-". --extra adds files from outside the folder (the Linux/macOS
// .tar.gz packages). The token is read from %USERPROFILE%\.mtg-release\github-token.txt (a fine-grained token with
// Contents read/write on this repo only); it is never printed, logged or written anywhere else.
"use strict";
const fs = require("fs");
const path = require("path");

const REPO = "Vibecoding-mods/Table-Top-Simulator-MTG-Rules-Enforcer";
const API = "https://api.github.com/repos/" + REPO;
const TOKEN_FILE = path.join(process.env.USERPROFILE || process.env.HOME || "", ".mtg-release", "github-token.txt");
const NOT_UPLOADED = new Set(["RELEASE-NOTES.md"]);

function args(argv) {
  const out = { extra: [], dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--dir") out.dir = argv[++i];
    else if (argv[i] === "--extra") { while (argv[i + 1] && !argv[i + 1].startsWith("--")) out.extra.push(argv[++i]); }
    else if (argv[i] === "--dry-run") out.dryRun = true;
    else throw new Error("unknown argument: " + argv[i]);
  }
  if (!out.dir) throw new Error("--dir dist/release-<tag> is required");
  return out;
}

function releaseFiles(dir, extra) {
  const files = fs.readdirSync(dir).filter((n) => !NOT_UPLOADED.has(n)).map((n) => path.join(dir, n))
    .filter((p) => fs.statSync(p).isFile());
  for (const p of extra) {
    if (!fs.existsSync(p)) throw new Error("extra file not found: " + p);
    files.push(p);
  }
  return files;
}

async function gh(fetch, token, url, opts = {}) {
  const r = await fetch(url, { ...opts, headers: { Authorization: "Bearer " + token, "User-Agent": "mtg-release",
    Accept: "application/vnd.github+json", ...(opts.headers || {}) } });
  const text = await r.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: r.status, body };
}

// opts (tests/test_publish_release.js): argv, fetch, tokenFile, log, write (stdout without a newline). Returns the
// count of files that failed to upload.
async function main(opts = {}) {
  const fetch = opts.fetch || globalThis.fetch;
  const log = opts.log || ((s) => console.log(s));
  const write = opts.write || ((s) => process.stdout.write(s));
  const tokenFile = opts.tokenFile || TOKEN_FILE;
  const a = args(opts.argv || process.argv.slice(2));
  const dir = path.resolve(a.dir);
  const tag = path.basename(dir).replace(/^release-/, "");
  if (tag === path.basename(dir)) throw new Error("the folder must be named release-<tag>");
  const files = releaseFiles(dir, a.extra);
  const notesFile = path.join(dir, "RELEASE-NOTES.md");
  const notes = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, "utf8") : "";
  log("tag " + tag + ", " + files.length + " files");
  if (a.dryRun) { for (const f of files) log("  " + path.basename(f)); return 0; }

  if (!fs.existsSync(tokenFile)) throw new Error("no token: save one to " + tokenFile);
  const token = fs.readFileSync(tokenFile, "utf8").trim();

  let rel = await gh(fetch, token, API + "/releases/tags/" + encodeURIComponent(tag));
  if (rel.status === 404) {
    rel = await gh(fetch, token, API + "/releases", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag_name: tag, name: "MTG Table " + tag, body: notes, draft: false, prerelease: false,
        make_latest: "true" }) });
    if (rel.status !== 201) throw new Error("creating the release failed: HTTP " + rel.status);
    log("created release " + tag);
  } else if (rel.status !== 200) {
    throw new Error("reading the release failed: HTTP " + rel.status);
  }
  const have = new Set((rel.body.assets || []).filter((x) => x.state === "uploaded").map((x) => x.name));
  const uploadBase = String(rel.body.upload_url || "").replace(/\{.*$/, "");
  // (the token goes with each upload: only to GitHub's own upload host, whatever the answer says)
  if (!uploadBase.startsWith("https://uploads.github.com/")) throw new Error("the release's upload address isn't on uploads.github.com: nothing uploaded");
  let failed = 0;
  for (const f of files) {
    // GitHub stores names with spaces as dots ("MTG Companion.exe" -> "MTG.Companion.exe")
    const name = path.basename(f).replace(/ /g, ".");
    if (have.has(name)) { log("  have     " + name); continue; }
    const size = fs.statSync(f).size;
    write("  upload   " + name + " (" + (size / 1048576).toFixed(1) + " MB) ... ");
    const r = await gh(fetch, token, uploadBase + "?name=" + encodeURIComponent(name), { method: "POST",
      headers: { "Content-Type": "application/octet-stream", "Content-Length": String(size) },
      body: fs.readFileSync(f) });
    if (r.status === 201) log("done");
    else { failed++; log("FAILED: HTTP " + r.status); }
  }
  log(failed ? failed + " file(s) failed; run again to retry them" : "all files on " + rel.body.html_url);
  return failed;
}

if (require.main === module) {
  main().then((failed) => { if (failed) process.exitCode = 1; })
    .catch((e) => { console.error("publish-release: " + e.message); process.exitCode = 1; });
}
module.exports = { main, args, releaseFiles, API, REPO, NOT_UPLOADED, TOKEN_FILE };
