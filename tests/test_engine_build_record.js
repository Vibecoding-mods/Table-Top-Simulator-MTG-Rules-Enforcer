// The engine build a deploy records (the owner's decision 2026-11-17: an own-server companion compares its server's
// engine with the table's). The id is what the engine is made of, never its tag: engine/engine-build-id.sh (and its
// twin tools/engine-build-id.js) hash the two pins and the two patches; engine/build-images.sh bakes it into the node
// image (--build-arg ENGINE_BUILD, SELF_HOSTED_NODE_ENGINE_BUILD); bridge/versions.js containerBuild reads the running
// node's; tools/deploy.js records the tree's as stack/deployed.json engineBuild (and refuses when the running node's
// differs); tools/make-friend-package.js carries it into the package (deployed.json, version.json).
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

  // ── the id: the pins and the patches, never the tag
  const os = require("os");
  const { engineBuildId } = require("../tools/engine-build-id");
  const ENG = path.join(ROOT, "engine");
  const copyEngine = (edit) => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "engine-build-id-"));
    for (const f of ["build-images.sh", "manabrew.patch", "forge.patch"]) fs.copyFileSync(path.join(ENG, f), path.join(d, f));
    if (edit) edit(d);
    return d;
  };
  const sh = (d) => cp.execFileSync("bash", [path.join(ENG, "engine-build-id.sh"), d], { encoding: "utf8" }).trim();
  const here = engineBuildId(ENG);
  ok("id: an eb- hash of 12 hex", /^eb-[0-9a-f]{12}$/.test(here), here);
  ok("id: the bash recipe (build-images.sh's) and the JS one (deploy's) agree", sh(ENG) === here, `${sh(ENG)} vs ${here}`);
  const tagged = copyEngine((d) => fs.writeFileSync(path.join(d, "build-images.sh"), fs.readFileSync(path.join(d, "build-images.sh"), "utf8").replace('tag="${1:-exile}"', 'tag="${1:-engine1122}"')));
  ok("id: the same patches under another default tag: the same id (no warning)", engineBuildId(tagged) === here && sh(tagged) === here);
  const byte = copyEngine((d) => { const f = path.join(d, "forge.patch"); const b = fs.readFileSync(f); b[b.length - 2] ^= 1; fs.writeFileSync(f, b); });
  ok("id: one byte of a patch changed: another id (the warning)", engineBuildId(byte) !== here && sh(byte) === engineBuildId(byte), `${engineBuildId(byte)} / ${sh(byte)}`);
  const pin = copyEngine((d) => fs.writeFileSync(path.join(d, "build-images.sh"), fs.readFileSync(path.join(d, "build-images.sh"), "utf8").replace(/^FORGE_COMMIT=.*$/m, "FORGE_COMMIT=0000000000000000000000000000000000000000")));
  ok("id: another pin: another id", engineBuildId(pin) !== here && sh(pin) === engineBuildId(pin));
  const crlf = copyEngine((d) => { const f = path.join(d, "manabrew.patch"); fs.writeFileSync(f, fs.readFileSync(f, "latin1").replace(/\n/g, "\r\n"), "latin1"); });
  ok("id: a Windows checkout (CRLF patches): the same id", engineBuildId(crlf) === here && sh(crlf) === here, `${engineBuildId(crlf)} / ${sh(crlf)}`);
  const swapped = copyEngine((d) => { const m = fs.readFileSync(path.join(d, "manabrew.patch")), f = fs.readFileSync(path.join(d, "forge.patch")); fs.writeFileSync(path.join(d, "manabrew.patch"), f); fs.writeFileSync(path.join(d, "forge.patch"), m); });
  ok("id: the patches told apart (swapped: another id)", engineBuildId(swapped) !== here);
  for (const d of [tagged, byte, pin, crlf, swapped]) fs.rmSync(d, { recursive: true, force: true });

  const deploy = fs.readFileSync(path.join(ROOT, "tools", "deploy.js"), "utf8");
  ok("deploy: records this tree's id as engineBuild, refuses a running engine of another", /const engineBuild = d\.engineBuildId\(\);/.test(deploy) && /if \(running && running !== engineBuild\) stop\(/.test(deploy) && /\.\.\.images, engineBuild, at:/.test(deploy));
  const pkg = fs.readFileSync(path.join(ROOT, "tools", "make-friend-package.js"), "utf8");
  ok("package: version.json carries engineBuild", /engineBuild: deployed\.engineBuild \|\| null,/.test(pkg));
  ok("package: deployed.json keeps the deploy's fields (engineBuild among them)", /const out = \{ \.\.\.deployed, bridge, save, at \};/.test(pkg));
  const images = fs.readFileSync(path.join(ROOT, "engine", "build-images.sh"), "utf8");
  ok("build-images: the node image is told the build id, never its tag", /build_id="\$\(bash "\$here\/engine-build-id\.sh" "\$here"\)"/.test(images) && /--build-arg ENGINE_BUILD="\$build_id" -t "mtg-forge-node:\$tag"/.test(images) && !/ENGINE_BUILD="\$tag"/.test(images));

  console.log(`${failed ? "FAIL" : "PASS"} test_engine_build_record: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.log(`FAIL test_engine_build_record: ${e.stack}`); process.exit(1); });
