// Update CHECK for the Linux/macOS companion (docs/companion-app-spec.md §11): asks GitHub for the latest release,
// fetches update-manifest.json and its .sig, verifies the signature against release-keys.txt BEFORE reading the
// manifest, refuses downgrades, and says what changed. It does not download or install parts: the release's runtime
// and companion parts are the Windows node.exe and exe, and the Windows app's journal/undo installer is not ported. An
// update found says "download the new package". Every URL and redirect must be https on a GitHub host; a token
// (MTG_GITHUB_TOKEN, needed while the repository is private) goes only to api.github.com.
"use strict";
const https = require("https");
const http = require("http");
const path = require("path");
const L = require("./mods").logic();
const probes = require("./probes");
const { Log } = require("./controller");

class Updater {
  // o: { controller, stateDir, keysFile, testBase }
  constructor(o) {
    this.o = o; this.c = o.controller;
    this.keys = L.parseKeys(probes.readText(o.keysFile));
    this.token = process.env.MTG_GITHUB_TOKEN || null;
    const st = this.state();
    this.c.update = { ...this.c.update, text: L.str(st, "lastResult") || "", lastCheck: L.str(st, "lastCheck") };
  }
  stateFile() { return path.join(this.o.stateDir, "updates.json"); }
  state() { return L.parseJson(probes.readText(this.stateFile())) || {}; }
  remember(k, v) { try { const d = this.state(); d[k] = v; probes.writeJsonAtomic(this.stateFile(), d); } catch { /* only a note */ } }
  checkDue() { return L.checkDue(L.str(this.state(), "lastCheck"), Date.now()); }

  // GET with every hop checked and redirects followed by hand (5 at most): { status, bytes } or { error }
  get(url, accept) {
    return new Promise((done) => {
      const hop = (u, n) => {
        if (n > 5) { done({ error: "too many redirects" }); return; }
        const ok = L.allowedUrl(u, this.o.testBase);
        if (!ok.ok) { done({ error: `refused ${(() => { try { return new URL(u).host; } catch { return "?"; } })()}: not a GitHub address` }); return; }
        const headers = { "User-Agent": L.Updates.UserAgent, Accept: accept };
        const bearer = L.tokenFor(ok.api, this.o.testBase, this.token);
        if (bearer) headers.Authorization = `Bearer ${bearer}`;
        const mod = u.startsWith("https:") ? https : http;
        const req = mod.get(u, { headers, timeout: 30000 }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400) {
            res.resume();
            if (!res.headers.location) { done({ error: "a redirect with no address" }); return; }
            hop(new URL(res.headers.location, u).href, n + 1);
            return;
          }
          const parts = [];
          res.on("data", (d) => parts.push(d));
          res.on("end", () => done({ status: res.statusCode, bytes: Buffer.concat(parts) }));
          res.on("error", (e) => done({ error: e.message }));
        });
        req.on("timeout", () => req.destroy(new Error("no answer in 30 s")));
        req.on("error", (e) => done({ error: e.message }));
      };
      hop(url, 0);
    });
  }

  async check() {
    const api = this.o.testBase || L.Updates.ApiBase;
    const text = (b) => b.toString("utf8").replace(/^﻿/, "");
    const r = await this.get(`${api}/repos/${L.Updates.Repo}/releases/latest`, "application/vnd.github+json");
    if (r.error || r.status !== 200) return { failed: true, quiet: r.status === 404, text: L.checkFailed(r.status || 0, r.error) };
    const rel = L.parseRelease(text(r.bytes));
    if (!rel) return { failed: true, text: "Couldn't check for updates (GitHub's answer has no usable release tag)." };
    const asset = rel.assets.find((a) => a.name === L.Updates.ManifestAsset);
    if (!asset) return { failed: true, text: `The latest release (${rel.tag}) has no ${L.Updates.ManifestAsset}: nothing to update from.` };
    const sigAsset = rel.assets.find((a) => a.name === L.Updates.SignatureAsset);
    if (!sigAsset) return { failed: true, text: `The update manifest of ${rel.tag} isn't signed (no ${L.Updates.SignatureAsset}): not used.` };
    const mr = await this.get(asset.url, "application/octet-stream");
    if (mr.error || mr.status !== 200) return { failed: true, text: `Couldn't read the update manifest (${mr.error || `HTTP ${mr.status}`}).` };
    const sr = await this.get(sigAsset.url, "application/octet-stream");
    if (sr.error || sr.status !== 200) return { failed: true, text: `Couldn't read the update manifest's signature (${sr.error || `HTTP ${sr.status}`}).` };
    // (the signature over the exact bytes, before the manifest is parsed)
    if (!L.verifySignature(mr.bytes, text(sr.bytes), this.keys)) return { failed: true, text: `The update manifest of ${rel.tag} isn't signed by this project's release key: not used.` };
    const pm = L.parseManifest(text(mr.bytes));
    if (!pm.m) return { failed: true, text: `The update manifest of ${rel.tag} is broken: ${pm.error}.` };
    if (pm.m.version !== rel.tag) return { failed: true, text: `The update manifest says ${pm.m.version} but sits in release ${rel.tag}: not used.` };
    const plan = L.updatePlan(this.c.version, pm.m, L.Updates.Format);
    return { manifest: pm.m, plan, text: plan.refused || (plan.upToDate ? `Up to date (${pm.m.version}).` : L.describe(plan, pm.m)) };
  }

  checkInBackground() {
    if (this.c.updateBusy) return;
    this.c.updateBusy = true;
    this.c.update = { ...this.c.update, status: "checking", error: null };
    this.c.fire();
    this.check().catch((e) => ({ failed: true, text: `Couldn't check for updates (${e.message}).` })).then((res) => {
      const now = new Date().toISOString();
      this.remember("lastCheck", now); this.remember("lastResult", res.text);
      Log.write(`update check: ${res.text}`);
      this.c.update = L.updateChecked(this.c.update, res, false, now);
      this.c.updateBusy = false;
      this.c.fire();
    });
  }
}

module.exports = { Updater };
