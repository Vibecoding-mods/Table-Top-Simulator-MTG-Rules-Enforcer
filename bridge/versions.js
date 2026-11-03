// Are the bridge, the table script and the engine the ones the last deploy put together? They are built and started
// separately, and each works alone, so a table from last week against a new engine fails only in play. tools/deploy.js
// writes stack/deployed.json; this file compares what is running with it. It warns and never blocks.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const ROOT = path.join(__dirname, "..");
const MANIFEST = path.join(ROOT, "stack", "deployed.json");
const BRIDGE_FILES = ["bridge.js", "state-delta.js", "presets.js", "versions.js"].map((f) => path.join(__dirname, f));
const TABLE_SOURCE = path.join(ROOT, "tools", "engine-renderer.lua");
const NODE_CONTAINER = "stack-forge-room-1", RELAY_CONTAINER = "stack-relay-1";

const sha8 = (data) => crypto.createHash("sha256").update(data).digest("hex").slice(0, 8);
const fileHash = (file) => { try { return sha8(fs.readFileSync(file)); } catch { return null; } };
// The bridge's code: every file of ours it loads
const bridgeHash = () => { try { return sha8(BRIDGE_FILES.map((f) => fs.readFileSync(f, "utf8")).join("\0")); } catch { return null; } };
const readManifest = () => { try { return JSON.parse(fs.readFileSync(MANIFEST, "utf8")); } catch { return null; } };

// The image each engine container is running: null for both when Docker can't say (down, or the stack isn't up)
function containerImages(done) {
  execFile("docker", ["inspect", "-f", "{{.Image}}", NODE_CONTAINER, RELAY_CONTAINER], { timeout: 8000 }, (err, out) => {
    const lines = String(out || "").trim().split(/\r?\n/);
    if (err || lines.length !== 2) return done({ node: null, relay: null });
    done({ node: lines[0].trim(), relay: lines[1].trim() });
  });
}

// now: { bridge, table, node, relay }. bridge: the hash of the code this process loaded. table: the stamp from the
// table's messages: undefined until one came, null from a table older than stamps. Returns what doesn't match, in a
// player's words.
function outOfStep(now, deployed) {
  if (!deployed) return ["No deploy on record: can't tell whether the bridge, table and engine match."];
  const out = [];
  if (now.bridge !== deployed.bridge) out.push("The bridge isn't the deployed one: restart it between games.");
  if (now.table === null) out.push("This table has no version: it is older than the last deploy. Load the save again.");
  else if (now.table === "dev") out.push("This table was built from source, not deployed.");
  else if (now.table !== undefined && now.table !== deployed.table) out.push("This table isn't the deployed one. Load the save again, and don't save over it from an older session.");
  if (now.node === null) out.push("Can't read the engine's containers: is Docker up?");
  else {
    if (now.node !== deployed.node) out.push("The engine isn't the deployed image.");
    if (now.relay !== deployed.relay) out.push("The relay isn't the deployed image.");
  }
  return out;
}

// Source edited since the deploy: not out of step yet, only waiting for the next one
const waiting = (deployed) => (deployed ? [
  ...(bridgeHash() !== deployed.bridge ? ["the bridge's code"] : []),
  ...(fileHash(TABLE_SOURCE) !== deployed.tableSource ? ["tools/engine-renderer.lua"] : []),
] : []);

module.exports = { MANIFEST, BRIDGE_FILES, TABLE_SOURCE, sha8, fileHash, bridgeHash, readManifest, containerImages, outOfStep, waiting };
