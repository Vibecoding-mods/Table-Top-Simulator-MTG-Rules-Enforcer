// The Linux/macOS companion's own checks as a deploy gate: companion-node/companion.js --selftest (every decision
// against canned inputs) and companion-node/breakit.js (each of its cases breaks one rule in a COPY of logic.js or
// platform.js and requires its named check to go red; the originals' sha256 is compared after). The companion ships in
// the friend packages and reads the bridge and the deploy record, so a change there is caught at deploy, not by a friend.
//   node tests/test_companion_node.js
const path = require("path");
const { spawnSync } = require("child_process");

const C = path.join(__dirname, "..", "companion-node");
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const tail = (s, n = 8) => String(s || "").trim().split("\n").slice(-n).join("\n  ");

function part(name, args, timeout) {
  const t = Date.now();
  const r = spawnSync(process.execPath, args, { cwd: C, encoding: "utf8", timeout, maxBuffer: 1 << 26 });
  const secs = Math.round((Date.now() - t) / 1000);
  return { ...r, secs, name };
}

// the selftest: exit code is the failure count; a run that printed no PASS line didn't run
{
  const r = part("selftest", [path.join(C, "companion.js"), "--selftest"], 120000);
  const fails = (r.stdout.match(/^FAIL .*/gm) || []);
  ok("companion-node selftest: exit 0, no FAIL line", r.status === 0 && fails.length === 0, `exit ${r.status}${r.error ? ` (${r.error.message})` : ""}\n  ${fails.slice(0, 10).join("\n  ") || tail(r.stdout + r.stderr)}`);
  ok("companion-node selftest: it ran (PASS lines)", /^PASS /m.test(r.stdout), tail(r.stdout + r.stderr));
  console.log(`selftest: ${(r.stdout.match(/^PASS /gm) || []).length} passed in ${r.secs} s`);
}

// the break-its: exit code is the cases that didn't go red, plus 100 if an original changed
{
  const r = part("breakit", [path.join(C, "breakit.js")], 600000);
  const m = /(\d+) of (\d+) breaks turned their check red/.exec(r.stdout);
  ok("companion-node breakit: exit 0", r.status === 0, `exit ${r.status}${r.error ? ` (${r.error.message})` : ""}\n  ${tail(r.stdout + r.stderr, 15)}`);
  ok("companion-node breakit: every break turned its check red", !!m && m[1] === m[2] && Number(m[2]) > 0, m ? m[0] : tail(r.stdout));
  ok("companion-node breakit: the originals untouched", /originals untouched/.test(r.stdout), tail(r.stdout));
  console.log(`breakit: ${m ? m[0] : "no summary"} in ${r.secs} s`);
}

// a redirect whose Location can't be parsed is an error answer, not an uncaught throw that ends the companion (2026-11-27)
(async () => {
  const http = require("http");
  const srv = http.createServer((q, r) => { r.writeHead(302, { Location: "http://[" }); r.end(); });
  await new Promise((d) => srv.listen(0, "127.0.0.1", d));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const { Updater } = require(path.join(C, "update.js"));
    const u = new Updater({ controller: { update: {} }, stateDir: require("os").tmpdir(), keysFile: path.join(C, "none.txt"), testBase: base });
    const res = await Promise.race([u.get(base + "/x", "application/json"), new Promise((d) => setTimeout(() => d({ error: "hung" }), 10000))]);
    ok("update.js: a malformed redirect address is an error answer", !!res && /broken address/.test(res.error || ""), JSON.stringify(res));
  } catch (err) { ok("update.js: a malformed redirect address is an error answer", false, String(err && err.message)); }
  srv.closeAllConnections?.(); srv.close();

  // lastCheck policy (update.js checkInBackground, 2026-11-27): a failed check (offline, 500) leaves it alone so the next
  // launch checks again; "not public" (404, quiet) is stamped so a private repo is not asked every launch
  const fs2 = require("fs"), os2 = require("os");
  for (const [status, stamped] of [[500, false], [404, true]]) {
    const name = `update.js: GitHub answers ${status}: lastCheck ${stamped ? "stamped" : "left alone"}`;
    const srv2 = http.createServer((q, r) => { r.writeHead(status, { "Content-Type": "application/json" }); r.end("{}"); });
    await new Promise((d) => srv2.listen(0, "127.0.0.1", d));
    const dir = fs2.mkdtempSync(path.join(os2.tmpdir(), "mtg-upd-"));
    try {
      const { Updater } = require(path.join(C, "update.js"));
      const c = { update: {}, version: "v1", updateBusy: false, fire() {} };
      const u = new Updater({ controller: c, stateDir: dir, keysFile: path.join(C, "none.txt"), testBase: `http://127.0.0.1:${srv2.address().port}` });
      u.checkInBackground();
      for (let i = 0; i < 100 && c.updateBusy; i++) await new Promise((d) => setTimeout(d, 50));
      const st = u.state();
      ok(name, !c.updateBusy && (st.lastCheck !== undefined) === stamped && typeof st.lastResult === "string", JSON.stringify(st));
    } catch (err) { ok(name, false, String(err && err.message)); }
    srv2.closeAllConnections?.(); srv2.close();
    try { fs2.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
