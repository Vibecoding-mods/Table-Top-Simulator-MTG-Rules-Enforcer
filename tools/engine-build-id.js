// The engine build id (engine/engine-build-id.sh, the same recipe): a short hash over the two pinned commits in
// engine/build-images.sh and our two patches, carriage returns removed. tools/deploy.js records it as
// stack/deployed.json engineBuild; the node image carries the same id (SELF_HOSTED_NODE_ENGINE_BUILD), so an own-server
// companion compares what the engines are made of, not their tags.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function engineBuildId(engineDir = path.join(__dirname, "..", "engine")) {
  const images = fs.readFileSync(path.join(engineDir, "build-images.sh"), "utf8");
  const pin = (name) => { const m = new RegExp(`^${name}=(.*)$`, "m").exec(images.replace(/\r/g, "")); if (!m) throw new Error(`no ${name} in build-images.sh`); return m[1]; };
  const patch = (f) => fs.readFileSync(path.join(engineDir, f)).toString("latin1").replace(/\r/g, "");
  const h = crypto.createHash("sha256");
  h.update(`manabrew ${pin("MANABREW_COMMIT")}\nforge ${pin("FORGE_COMMIT")}\n`, "latin1");
  h.update(patch("manabrew.patch"), "latin1");
  h.update("\0", "latin1");
  h.update(patch("forge.patch"), "latin1");
  return `eb-${h.digest("hex").slice(0, 12)}`;
}

module.exports = { engineBuildId };
if (require.main === module) console.log(engineBuildId(process.argv[2]));
