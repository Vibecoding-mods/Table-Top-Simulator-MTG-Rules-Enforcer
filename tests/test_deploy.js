// tools/deploy.js main() with every effect stubbed (no gate, docker, bridge, TTS or save is touched: main is handed fake
// deps that record each step). Checks the order (idle, engine tree and its test list, the save's dry run, every gate,
// the patched script, the engine's Java tests, the engine swap, the bridge, the save, the record last) and that each
// failure stops it with nothing after it moved. Also the harness list rule: every *Test.java under the engine tree's
// forge-harness/src/test is in engine/checks/harness-tests.sh's default list (on a fake tree, and on the real one
// MTG_MANABREW names, as the deploy runs it).
//   node tests/test_deploy.js
require("./no-live-ports");
const fs = require("fs");
const os = require("os");
const path = require("path");
const deploy = require("../tools/deploy");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${typeof why === "string" ? why : JSON.stringify(why)}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-test-"));
const ROOT = path.join(__dirname, "..");
const REAL_SCRIPT = fs.readFileSync(deploy.HARNESS_SCRIPT, "utf8");

// a fake engine tree: test classes in host/ and common/, and a bench that isn't a test
function fakeTree(name, files) {
  const t = path.join(tmp, name);
  for (const f of files) {
    const p = path.join(t, "forge-harness", "src", "test", "java", "forge", "harness", f);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "class X {}");
  }
  return t;
}
const tree = fakeTree("tree", ["host/AlphaTest.java", "host/BetaTest.java", "common/GammaTest.java", "host/SomeBench.java"]);
const SCRIPT = "set -e\n[ $# -gt 0 ] || set -- AlphaTest \\\n  BetaTest common.GammaTest\nfailed=\"\"\n";

// ── the harness list rule (pure)
{
  same("harness list: the names after `set --`, over continued lines", deploy.harnessDefaults(SCRIPT), ["AlphaTest", "BetaTest", "common.GammaTest"]);
  same("harness list: a tree's test classes, named as the script names them (benches left out)", deploy.harnessTestClasses(tree), ["AlphaTest", "BetaTest", "common.GammaTest"]);
  same("harness list: nothing missing when the list has every class", deploy.missingFromHarness(tree, SCRIPT), []);
  const t2 = fakeTree("tree2", ["host/AlphaTest.java", "host/BetaTest.java", "common/GammaTest.java", "host/NewOneTest.java", "common/DeltaTest.java"]);
  same("harness list: a new class not in the list is named", deploy.missingFromHarness(t2, SCRIPT), ["NewOneTest", "common.DeltaTest"]);
  ok("harness list: a script without the list is null, not a pass", deploy.missingFromHarness(tree, "echo hi\n") === null);
  const real = deploy.harnessDefaults(REAL_SCRIPT) || [];
  ok("harness list: the repo's script has its list (53+ classes, common.GiftTargetsTest among them)", real.length >= 53 && real.includes("common.GiftTargetsTest") && real.includes("MindslaverControlTest"), real.length);
  ok("harness list: the repo's script names no class twice", new Set(real).size === real.length);
  // the real tree going out, as the deploy runs this gate (MTG_MANABREW set); without it the deploy itself checks it
  if (process.env.MTG_MANABREW) {
    const t = path.resolve(ROOT, process.env.MTG_MANABREW);
    const missing = fs.existsSync(path.join(t, "forge-harness", "src", "test", "java")) ? deploy.missingFromHarness(t, REAL_SCRIPT) : ["(no forge-harness/src/test/java)"];
    same(`harness list: every test class of MTG_MANABREW's tree is in engine/checks/harness-tests.sh`, missing, []);
  } else console.log("note: MTG_MANABREW not set: the real engine tree's test list is checked by the deploy itself");
}

// ── main, stubbed
const GATE_COUNT = deploy.GATES.length;
function fake(over = {}) {
  const steps = [];
  const d = {
    argv: over.argv || [],
    env: "env" in over ? over.env : { MTG_MANABREW: tree },
    log: () => {},
    getJson: async (url) => {
      steps.push(`get ${url.replace("http://127.0.0.1:48787", "")}`);
      if (url.endsWith("/state")) { if (over.noBridge) throw Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }); return { started: !!over.gameRunning }; }
      if (url.endsWith("/versions")) return { now: { bridge: over.bridgeUp === false ? "old" : "bh" } };
      throw new Error(`unexpected ${url}`);
    },
    sleep: async () => {},
    ttsRunning: () => { steps.push("tts?"); return !!over.ttsRunning; },
    patchSave: (write) => { steps.push(`patchSave ${write ? "write" : "dry"}`); if (over.saveFails && !write) throw new Error("the save can't be patched"); return write ? { stamp: "stamp1", save: "save1" } : { trial: "{\"trial\":1}" }; },
    engineBuildId: () => "eb-test",
    versions: {
      MANIFEST: path.join(tmp, "deployed.json"), TABLE_SOURCE: [],
      bridgeHash: () => "bh", fileHash: () => "th",
      containerImages: (done) => done(over.noImages ? {} : { node: "sha256:0123456789abcdef0123", relay: "sha256:r" }),
      containerBuild: (done) => done(over.runningBuild === undefined ? "eb-test" : over.runningBuild),
    },
    run: (cmd, args, env) => {
      const what = cmd === process.execPath ? `node ${args.join(" ")}` : `${cmd} ${args.join(" ")}`;
      const label = env && env.TABLE_SAVE ? `${what} (TABLE_SAVE)` : what;
      steps.push(label);
      if (over.failRun && over.failRun(label)) throw new Error(`Command failed: ${label}`);
    },
    capture: (cmd, args) => { steps.push(`capture ${args.join(" ")}`); return over.liveLog || "pass: x\nPASSED: 9 of 9\n"; },
    imageExists: (tag) => { steps.push(`exists ${tag}`); return over.relay !== false; },
    stream: async (cmd, args) => {
      const what = `${cmd} ${args[0]}`;
      steps.push(what);
      d.streamed.push(args);
      if (what === "docker build") return over.build || { code: 0, out: "" };
      return over.engine || { code: 0, out: "=== AlphaTest\nexit=0\nPASSED: AlphaTest BetaTest common.GammaTest\n" };
    },
    readFile: (f) => {
      if (f === deploy.HARNESS_SCRIPT) return over.script || SCRIPT;
      if (f.endsWith("forge-cards.json")) return JSON.stringify({ engineBuild: over.cardList || "eb-test" });
      throw new Error(`unexpected read ${f}`);
    },
    writeFile: (f, s) => { steps.push(f === d.versions.MANIFEST ? "write manifest" : `write ${path.basename(f)}`); if (f === d.versions.MANIFEST) d.manifest = JSON.parse(s); },
    removeFile: (f) => steps.push(`remove ${path.basename(f)}`),
    streamed: [],
  };
  return { d, steps };
}
const go = async (over) => { const f = fake(over); let error = null; try { await deploy.main(f.d); } catch (e) { error = e.message; } return { ...f, error }; };
const idx = (steps, s) => steps.findIndex((x) => (s instanceof RegExp ? s.test(x) : x === s));
const moved = (steps) => steps.filter((s) => /^docker (tag|compose)|start-bridge|^patchSave write|^write manifest|build-forge-card-index/.test(s));

(async () => {
  // ── a whole deploy, the engine as it is, its tests asked for (--engine-tests)
  {
    const { steps, error, d } = await go({ argv: ["--engine-tests"] });
    ok("order: no error on a clean run", error === null, error);
    const gates = steps.filter((s) => /^node tests\/test_\w+\.js$/.test(s));
    same("order: every gate, in GATES order", gates, deploy.GATES.map((g) => `node tests/${g}.js`));
    ok("order: the idle check comes first", steps[0] === "get /state" && steps[1] === "tts?", steps.slice(0, 3));
    ok("order: the save's dry run before any gate", idx(steps, "patchSave dry") > 0 && idx(steps, "patchSave dry") < idx(steps, /^node tests\//), steps.slice(0, 5));
    ok("order: the patched script plays after the gates, then its file goes", idx(steps, "node tests/test_table_check.js (TABLE_SAVE)") > idx(steps, `node tests/${deploy.GATES.at(-1)}.js`) && idx(steps, "remove patched-trial.json") > idx(steps, "node tests/test_table_check.js (TABLE_SAVE)"));
    ok("order: the engine tests after the patched script: the image built, then the run", idx(steps, "docker build") > idx(steps, "remove patched-trial.json") && idx(steps, "docker run") > idx(steps, "docker build"), steps.slice(-12));
    ok("order: the bridge starts after the engine tests, with an idle check just before", idx(steps, /start-bridge/) > idx(steps, "docker run") && steps[idx(steps, /start-bridge/) - 1] === "tts?" && steps[idx(steps, /start-bridge/) - 2] === "get /state");
    ok("order: the bridge is checked, then the save written, then the record last", idx(steps, "get /versions") > idx(steps, /start-bridge/) && idx(steps, "patchSave write") > idx(steps, "get /versions") && steps.at(-1) === "write manifest", steps.slice(-5));
    ok("order: no engine swap without --image", !steps.some((s) => /^docker (tag|compose)/.test(s) || /^capture/.test(s)));
    ok("order: the card list matches this build: not rebuilt", !steps.some((s) => /build-forge-card-index/.test(s)));
    ok("record: what went out", d.manifest && d.manifest.bridge === "bh" && d.manifest.table === "stamp1" && d.manifest.save === "save1" && d.manifest.engineBuild === "eb-test" && d.manifest.node, d.manifest);
    const [build = [], runArgs = []] = d.streamed; // (empty when the engine tests never ran: the checks below then fail by name)
    ok("engine tests: the image is the tree's java-builder stage, tagged with the build id", build.includes("--target") && build[build.indexOf("--target") + 1] === "java-builder" && build.includes("mtg-harness-test:eb-test") && build.at(-1) === tree.replace(/\\/g, "/") && build.some((a) => /self-hosted-node\/Dockerfile$/.test(a)), build);
    ok("engine tests: the tree's harness read-only and the repo's harness-tests.sh, every class (no class named)", runArgs.includes(`${tree.replace(/\\/g, "/")}/forge-harness:/src:ro`) && runArgs.includes(`${deploy.HARNESS_SCRIPT.replace(/\\/g, "/")}:/harness-tests.sh:ro`) && runArgs.at(-1) === "/harness-tests.sh" && runArgs.at(-2) === "mtg-harness-test:eb-test", runArgs);
    ok(`order: ${GATE_COUNT} gates ran`, gates.length === GATE_COUNT);
  }

  // ── a bridge and table deploy (no --image, no --engine-tests): the engine's tests are skipped, the rest as before
  {
    const { steps, error, d } = await go();
    ok("skip: no error", error === null, error);
    ok("skip: no engine test image built or run", !steps.includes("docker build") && !steps.includes("docker run") && (d.streamed || []).length === 0, steps.filter((x) => /docker/.test(x)));
    ok("skip: every gate still ran, then the bridge and the save", steps.filter((x) => /^node tests\/test_\w+\.js$/.test(x)).length === GATE_COUNT && idx(steps, /start-bridge/) > 0 && idx(steps, "patchSave write") > idx(steps, /start-bridge/), steps.slice(-6));
  }

  // ── with --image: live checks after the engine tests, then the swap, before the bridge
  {
    const { steps, error } = await go({ argv: ["--image", "engine9999"] });
    ok("--image: no error", error === null, error);
    ok("--image: the live checks after the engine tests", idx(steps, /^capture tools\/live-check\.sh engine9999/) > idx(steps, "docker run"), steps.slice(-14));
    ok("--image: node and relay retagged, the stack recreated, after an idle check, before the bridge", idx(steps, "docker tag mtg-forge-node:engine9999 mtg-forge-node:exile") > idx(steps, /^capture/) && idx(steps, "docker tag mtg-relay:engine9999 mtg-relay:exile") > 0 && idx(steps, /^docker compose/) < idx(steps, /start-bridge/) && steps[idx(steps, /^docker tag mtg-forge-node/) - 1] === "tts?");
  }
  {
    const { steps, error } = await go({ argv: ["--image", "engine9999"], liveLog: "FAILED: 2 of 9\n" });
    ok("--image: a live check that didn't pass stops it, nothing swapped", /didn't pass on engine9999/.test(error || "") && moved(steps).length === 0, [error, moved(steps)]);
  }
  {
    const { steps, error } = await go({ argv: ["--image"] });
    ok("--image with no tag: stopped before anything", /needs a tag/.test(error || "") && steps.length === 0, [error, steps]);
    const r2 = await go({ argv: ["--image", "--other"] });
    ok("--image followed by a flag: stopped before anything", /needs a tag/.test(r2.error || "") && r2.steps.length === 0, r2.error);
  }

  // ── each failure stops it, with nothing after it moved
  {
    const { steps, error } = await go({ gameRunning: true });
    ok("a game running: stopped before the save or a gate", /a game is running/.test(error || "") && !steps.some((s) => /patchSave|node tests/.test(s)), [error, steps]);
  }
  {
    const { steps, error } = await go({ ttsRunning: true });
    ok("TTS running: stopped before the save or a gate", /TTS is running/.test(error || "") && !steps.some((s) => /patchSave|node tests/.test(s)), [error, steps]);
  }
  {
    const { error } = await go({ noBridge: true });
    ok("no bridge up (refused): no game, so it goes on", error === null, error);
  }
  {
    const { steps, error } = await go({ env: {} });
    ok("no MTG_MANABREW: stopped before the save or a gate, saying why", /MTG_MANABREW isn't set/.test(error || "") && !steps.some((s) => /patchSave|node tests/.test(s)), [error, steps]);
    const r2 = await go({ env: { MTG_MANABREW: path.join(tmp, "nowhere") } });
    ok("MTG_MANABREW with no harness tests in it: stopped before a gate", /no forge-harness\/src\/test\/java/.test(r2.error || "") && !r2.steps.some((s) => /node tests/.test(s)), r2.error);
  }
  {
    const { steps, error } = await go({ script: "set -e\n[ $# -gt 0 ] || set -- AlphaTest common.GammaTest\n" });
    ok("a test class left out of harness-tests.sh: stopped before a gate, naming it", /BetaTest is in .* but not in engine\/checks\/harness-tests\.sh's default list/.test(error || "") && !steps.some((s) => /patchSave|node tests/.test(s)), [error, steps.slice(0, 4)]);
    const r2 = await go({ script: "echo nothing\n" });
    ok("harness-tests.sh without its list: stopped", /can't find the default class list/.test(r2.error || ""), r2.error);
  }
  {
    const { steps, error } = await go({ saveFails: true });
    ok("a save that can't be patched: stopped before any gate", /can't be patched/.test(error || "") && !steps.some((s) => /node tests/.test(s)), error);
  }
  {
    const bad = deploy.GATES[5];
    const { steps, error } = await go({ failRun: (w) => w === `node tests/${bad}.js` });
    ok("a failed gate: stopped there, naming it", (error || "").includes(bad) && steps.filter((s) => /^node tests\//.test(s)).length === 6, error);
    ok("a failed gate: no engine test, nothing moved", !steps.some((s) => /^docker/.test(s)) && moved(steps).length === 0, moved(steps));
  }
  {
    const { steps, error } = await go({ failRun: (w) => w === "node tests/test_table_check.js (TABLE_SAVE)" });
    ok("the patched script failing its check: stopped before the engine tests, nothing moved", !!error && !steps.some((s) => /^docker/.test(s)) && moved(steps).length === 0, error);
  }
  {
    const { steps, error } = await go({ argv: ["--image", "engine9999"], engine: { code: 1, out: "=== BetaTest\nexit=1\nFAIL something\nFAILED: BetaTest\n" } });
    ok("engine tests failing: stopped, naming the failed classes", /engine tests didn't pass \(exit 1, FAILED: BetaTest\)/.test(error || ""), error);
    ok("engine tests failing: no live check, no swap, no bridge, no save, no record", !steps.some((s) => /^capture/.test(s)) && moved(steps).length === 0, moved(steps));
  }
  {
    const { steps, error } = await go({ argv: ["--engine-tests"], engine: { code: 0, out: "=== AlphaTest\nexit=0\n" } });
    ok("engine tests: exit 0 without the PASSED line is no pass", /engine tests didn't pass \(exit 0, no PASSED line\)/.test(error || "") && moved(steps).length === 0, error);
  }
  {
    const { steps, error } = await go({ argv: ["--engine-tests"], engine: { code: -1, out: "spawn docker ENOENT\n" } });
    ok("engine tests that can't run (no docker): stopped", /engine tests didn't pass \(exit -1/.test(error || "") && moved(steps).length === 0, error);
  }
  {
    const { steps, error } = await go({ argv: ["--engine-tests"], build: { code: 1, out: "ERROR: failed to solve\n" } });
    ok("the test image not building: stopped before the run, nothing moved", /didn't build/.test(error || "") && !steps.includes("docker run") && moved(steps).length === 0, error);
  }
  {
    const { steps, error } = await go({ cardList: "eb-older" });
    ok("a card list for another build: rebuilt before the bridge starts", error === null && idx(steps, /build-forge-card-index/) > 0 && idx(steps, /build-forge-card-index/) < idx(steps, /start-bridge/), error);
  }
  {
    // (the list is read from the running engine: an old engine must not get a list stamped with this tree's build id)
    const { steps, error } = await go({ cardList: "eb-older", runningBuild: "eb-other" });
    ok("a card list for another build and a running engine of a third: stopped before the list is built or anything moves",
      /the running engine is build eb-other/.test(error || "") && !steps.some((s) => /build-forge-card-index|start-bridge/.test(s)) && !steps.includes("write manifest"), error);
  }
  {
    const { steps, error } = await go({ bridgeUp: false });
    ok("the bridge not the new one: stopped, the save not written, no record", /bridge running isn't the new one/.test(error || "") && !steps.includes("patchSave write") && !steps.includes("write manifest"), error);
  }
  {
    const { steps, error } = await go({ runningBuild: "eb-other" });
    ok("the running engine another build: stopped, no record", /running engine is build eb-other/.test(error || "") && !steps.includes("write manifest"), error);
    const r2 = await go({ noImages: true });
    ok("Docker can't say what the engine is: stopped, no record", /Docker can't say/.test(r2.error || "") && !r2.steps.includes("write manifest"), r2.error);
    const r3 = await go({ runningBuild: null });
    ok("an engine image older than build ids: recorded with this tree's", r3.error === null && r3.steps.at(-1) === "write manifest", r3.error);
  }

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${passed} passed, ${failed} failed`);
  process.exitCode = failed ? 1 : 0;
})();
