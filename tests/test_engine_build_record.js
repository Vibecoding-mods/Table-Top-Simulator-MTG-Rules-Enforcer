// The engine build a deploy records (the owner's decision 2026-11-17: an own-server companion compares its server's
// engine with the table's). bridge/versions.js containerBuild reads the running node's SELF_HOSTED_NODE_ENGINE_BUILD
// (the image's tag, engine/build-images.sh --build-arg ENGINE_BUILD); tools/deploy.js writes it to stack/deployed.json
// as engineBuild; tools/make-friend-package.js carries it into the package (deployed.json, version.json).
//   node tests/test_engine_build_record.js
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${why}` : ""}`); } };
const ROOT = path.join(__dirname, "..");

const real = cp.execFile;
let answer = null;
const asked = [];
cp.execFile = (cmd, args, opts, done) => { asked.push([cmd, ...args]); answer(done); };
const versions = require("../bridge/versions");
cp.execFile = real;
const build = (fake) => new Promise((done) => { answer = fake; versions.containerBuild(done); });

(async () => {
  let b = await build((done) => done(null, "PATH=/usr/bin\nSELF_HOSTED_NODE_ENGINE_BUILD=engine1121-ownerdecisions\nLD_LIBRARY_PATH=/x\n"));
  ok("containerBuild: the node's build from its environment", b === "engine1121-ownerdecisions", b);
  ok("containerBuild: asks docker about the node's container", asked.length === 1 && asked[0][0] === "docker" && asked[0].includes("inspect") && /forge-room-1$/.test(asked[0][asked[0].length - 1]), JSON.stringify(asked));
  b = await build((done) => done(null, "PATH=/usr/bin\n"));
  ok("containerBuild: an image older than the setting: null", b === null, b);
  b = await build((done) => done(null, "SELF_HOSTED_NODE_ENGINE_BUILD=\n"));
  ok("containerBuild: an empty build (an image built without a tag): null", b === null, b);
  b = await build((done) => done(new Error("no docker"), ""));
  ok("containerBuild: Docker can't say: null", b === null, b);
  b = await build((done) => done(new Error("exit status 1: no such container"), "SELF_HOSTED_NODE_ENGINE_BUILD=engine1121\n"));
  ok("containerBuild: Docker failing after printing a build: null (not trusted)", b === null, b);
  b = await build((done) => done(null, "SELF_HOSTED_NODE_ENGINE_BUILD=engine1121\r\nOTHER=1\r\n"));
  ok("containerBuild: Windows line ends", b === "engine1121", b);

  const deploy = fs.readFileSync(path.join(ROOT, "tools", "deploy.js"), "utf8");
  ok("deploy: records the node's build as engineBuild", /const engineBuild = await new Promise\(\(done\) => versions\.containerBuild\(done\)\);/.test(deploy) && /\.\.\.images, engineBuild, at:/.test(deploy));
  const pkg = fs.readFileSync(path.join(ROOT, "tools", "make-friend-package.js"), "utf8");
  ok("package: version.json carries engineBuild", /engineBuild: deployed\.engineBuild \|\| null,/.test(pkg));
  ok("package: deployed.json keeps the deploy's fields (engineBuild among them)", /const out = \{ \.\.\.deployed, bridge, save, at \};/.test(pkg));
  const images = fs.readFileSync(path.join(ROOT, "engine", "build-images.sh"), "utf8");
  ok("build-images: the node image is told its tag", /--build-arg ENGINE_BUILD="\$tag" -t "mtg-forge-node:\$tag"/.test(images));

  console.log(`${failed ? "FAIL" : "PASS"} test_engine_build_record: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_engine_build_record: ${e.stack}`); process.exit(1); });
