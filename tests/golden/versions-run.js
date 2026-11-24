// Golden-master runner for bridge/versions.js: outOfStep on a grid of running-vs-deployed records (each field equal,
// different, null, undefined, "dev", remote, the friend package's config digests), sha8 and fileHash on fixed bytes,
// and containerImages / containerBuild with a fake execFile (recording the exact docker command, timeout and container
// names; answering with errors, short output, CRLF, missing settings). Not covered, on purpose: bridgeHash and waiting
// (their answer is a hash of the live source, which every edit changes) and readManifest (reads the real
// stack/deployed.json). Shared by tools/capture_versions_golden.js and tests/test_versions_golden.js.
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const { enc } = require("./teams-run");

const MOD = path.join(__dirname, "..", "..", "bridge", "versions.js");

function load(cp) {
  const orig = Module._load;
  Module._load = function (req, parent, ...rest) {
    if (parent && parent.filename === MOD && req === "child_process") return cp;
    return orig.call(this, req, parent, ...rest);
  };
  const env = process.env.COMPOSE_PROJECT_NAME;
  process.env.COMPOSE_PROJECT_NAME = "golden"; // (the container names, not read from the real compose file)
  try { delete require.cache[MOD]; return require(MOD); } finally { Module._load = orig; delete require.cache[MOD]; if (env === undefined) delete process.env.COMPOSE_PROJECT_NAME; else process.env.COMPOSE_PROJECT_NAME = env; }
}

async function runAll() {
  const out = [];
  const calls = [];
  let answer = { err: null, out: "" };
  const cp = { execFile: (cmd, args, opts, cb) => { calls.push({ cmd, args, timeout: opts?.timeout }); setImmediate(() => cb(answer.err, answer.out)); } };
  const V = load(cp);
  out.push({ name: "surface", result: Object.keys(V).sort().map((k) => [k, typeof V[k], typeof V[k] === "function" ? V[k].length : null]) });
  out.push({ name: "BRIDGE_FILES (names)", result: V.BRIDGE_FILES.map((f) => path.basename(f)) });
  out.push({ name: "TABLE_SOURCE (names)", result: V.TABLE_SOURCE.map((f) => path.relative(path.join(__dirname, "..", ".."), f).split(path.sep).join("/")) });

  // outOfStep
  const D = { bridge: "b1", table: "t1", node: "n1", relay: "r1", nodeConfig: "nc", relayConfig: "rc" };
  const nows = {
    allMatch: { bridge: "b1", table: "t1", node: "n1", relay: "r1" }, bridgeDiff: { bridge: "b2", table: "t1", node: "n1", relay: "r1" }, tableNull: { bridge: "b1", table: null, node: "n1", relay: "r1" },
    tableUndef: { bridge: "b1", node: "n1", relay: "r1" }, tableDev: { bridge: "b1", table: "dev", node: "n1", relay: "r1" }, tableDiff: { bridge: "b1", table: "t2", node: "n1", relay: "r1" },
    tableEmpty: { bridge: "b1", table: "", node: "n1", relay: "r1" }, nodeNull: { bridge: "b1", table: "t1", node: null, relay: null }, nodeUndef: { bridge: "b1", table: "t1" },
    nodeConfig: { bridge: "b1", table: "t1", node: "nc", relay: "rc" }, nodeDiff: { bridge: "b1", table: "t1", node: "n2", relay: "r1" }, relayDiff: { bridge: "b1", table: "t1", node: "n1", relay: "r2" },
    crossed: { bridge: "b1", table: "t1", node: "rc", relay: "nc" }, remote: { bridge: "b1", table: "t1", remote: true, node: null }, remoteDiff: { bridge: "b2", table: "t2", remote: true },
    everything: { bridge: "x", table: "y", node: "z", relay: "w" }, empty: {},
  };
  const deps = { deployed: D, none: null, undef: undefined, noConfig: { bridge: "b1", table: "t1", node: "n1", relay: "r1" }, configUndefMatch: { bridge: "b1", table: "t1" } };
  for (const [nk, now] of Object.entries(nows)) for (const [dk, d] of Object.entries(deps)) {
    let row;
    try { row = { result: V.outOfStep(now, d) }; } catch (e) { row = { threw: { type: e?.constructor?.name, message: e?.message } }; }
    out.push({ name: `outOfStep ${nk} vs ${dk}`, ...row });
  }
  try { out.push({ name: "outOfStep null now", result: V.outOfStep(null, D) }); } catch (e) { out.push({ name: "outOfStep null now", threw: { type: e?.constructor?.name, message: e?.message } }); }

  // sha8 / fileHash on fixed bytes in a temp folder (its path is not recorded)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "versions-golden-"));
  try {
    const a = path.join(dir, "a.txt"), b = path.join(dir, "b.txt"), bin = path.join(dir, "c.bin");
    fs.writeFileSync(a, "alpha\n"); fs.writeFileSync(b, "ünï\r\nbeta"); fs.writeFileSync(bin, Buffer.from([0, 255, 10, 13]));
    for (const [k, v] of [["empty", ""], ["text", "hello"], ["unicode", "ünï 🎉"], ["buffer", Buffer.from([1, 2, 3])]]) out.push({ name: `sha8 ${k}`, result: V.sha8(v) });
    for (const [k, f] of [["one file", a], ["binary", bin], ["list", [a, b]], ["list reversed", [b, a]], ["list of one", [a]], ["empty list", []], ["missing", path.join(dir, "nope")], ["list with a missing", [a, path.join(dir, "nope")]]]) out.push({ name: `fileHash ${k}`, result: V.fileHash(f) });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  // containerImages / containerBuild
  const img = (k, a) => new Promise((r) => { answer = a; calls.length = 0; V.containerImages((x) => r({ name: `containerImages ${k}`, result: x, calls: [...calls] })); });
  const bld = (k, a) => new Promise((r) => { answer = a; calls.length = 0; V.containerBuild((x) => r({ name: `containerBuild ${k}`, result: x, calls: [...calls] })); });
  for (const [k, a] of [["two lines", { err: null, out: "sha256:n\nsha256:r\n" }], ["CRLF and spaces", { err: null, out: " sha256:n \r\n sha256:r \r\n" }], ["one line", { err: null, out: "sha256:n\n" }],
    ["three lines", { err: null, out: "a\nb\nc" }], ["error with output", { err: new Error("no such container"), out: "a\nb" }], ["empty", { err: null, out: "" }], ["undefined out", { err: null, out: undefined }]]) out.push(await img(k, a));
  for (const [k, a] of [["set", { err: null, out: "PATH=/bin\nSELF_HOSTED_NODE_ENGINE_BUILD=abc123 \nX=1\n" }], ["CRLF", { err: null, out: "SELF_HOSTED_NODE_ENGINE_BUILD=abc\r\nY=2\r\n" }], ["missing", { err: null, out: "PATH=/bin\n" }],
    ["empty value", { err: null, out: "SELF_HOSTED_NODE_ENGINE_BUILD=\n" }], ["prefix only inside another", { err: null, out: "X_SELF_HOSTED_NODE_ENGINE_BUILD=zz\n" }], ["error", { err: new Error("down"), out: "SELF_HOSTED_NODE_ENGINE_BUILD=abc\n" }],
    ["two lines, first wins", { err: null, out: "SELF_HOSTED_NODE_ENGINE_BUILD=one\nSELF_HOSTED_NODE_ENGINE_BUILD=two\n" }]]) out.push(await bld(k, a));
  return out;
}

module.exports = { runAll };
