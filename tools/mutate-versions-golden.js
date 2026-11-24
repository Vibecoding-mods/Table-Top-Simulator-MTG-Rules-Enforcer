// Grades tests/test_versions_golden.js (the bridge/versions.js golden master) with tools/mutate-golden-lib.js: each
// mutation below is a plausible careless change; the golden must go red by name.
//   node tools/mutate-versions-golden.js [label pattern]
// First pass 2026-11-24: 21 of 22 caught (4.5%, SOUND). The escape was an equivalent mutant as written (== null and
// !== undefined is === null); it now reads the table by truthiness and is caught by the "" row.
const path = require("path");
const { runMutations } = require("./mutate-golden-lib");

const ROOT = path.join(__dirname, "..");

// [label, from, to, equivalent?]: `from` must occur exactly once in versions.js
const MUTATIONS = [
  ["BRIDGE_FILES: teams.js left out", "\"gifs.js\", \"teams.js\", \"accomplishments.js\"", "\"gifs.js\", \"accomplishments.js\""],
  ["sha8: 7 characters", "digest(\"hex\").slice(0, 8);", "digest(\"hex\").slice(0, 7);"],
  ["fileHash: list joined without a separator", "file.map((x) => fs.readFileSync(x, \"utf8\")).join(\"\\0\"))", "file.map((x) => fs.readFileSync(x, \"utf8\")).join(\"\"))"],
  ["fileHash: a single file read as text", ": sha8(fs.readFileSync(file)); } catch { return null; } };", ": sha8(fs.readFileSync(file, \"utf8\")); } catch { return null; } };"],
  ["fileHash: a missing file throws", "; } catch { return null; } };\n// The bridge's code", "; } catch (e) { throw e; } };\n// The bridge's code"],
  ["containerImages: a line count other than 2 accepted", "if (err || lines.length !== 2) return done", "if (err || lines.length < 2) return done"],
  ["containerImages: error ignored", "if (err || lines.length !== 2) return done", "if (lines.length !== 2) return done"],
  ["containerImages: lines not trimmed", "done({ node: lines[0].trim(), relay: lines[1].trim() });", "done({ node: lines[0], relay: lines[1] });"],
  ["containerImages: node and relay swapped", "done({ node: lines[0].trim(), relay: lines[1].trim() });", "done({ node: lines[1].trim(), relay: lines[0].trim() });"],
  ["containerImages: timeout changed", "\"{{.Image}}\", NODE_CONTAINER, RELAY_CONTAINER], { timeout: 8000 }", "\"{{.Image}}\", NODE_CONTAINER, RELAY_CONTAINER], { timeout: 80000 }"],
  ["containerBuild: prefix match anywhere", "find((l) => l.startsWith(\"SELF_HOSTED_NODE_ENGINE_BUILD=\"))", "find((l) => l.includes(\"SELF_HOSTED_NODE_ENGINE_BUILD=\"))"],
  ["containerBuild: value not trimmed", "slice(\"SELF_HOSTED_NODE_ENGINE_BUILD=\".length).trim() : \"\";", "slice(\"SELF_HOSTED_NODE_ENGINE_BUILD=\".length) : \"\";"],
  ["containerBuild: error ignored", "done(err || !build ? null : build);", "done(!build ? null : build);"],
  ["outOfStep: bridge check dropped", "  if (now.bridge !== deployed.bridge) out.push(", "  if (false) out.push("],
  ["outOfStep: table null read by truthiness (\"\" and 0 too)", "if (now.table === null) out.push(", "if (!now.table && now.table !== undefined) out.push("],
  ["outOfStep: an unstamped table (undefined) reported as different", "else if (now.table !== undefined && now.table !== deployed.table)", "else if (now.table !== deployed.table)"],
  ["outOfStep: dev table not told apart", "  else if (now.table === \"dev\") out.push(\"This table was built from source, not deployed.\");\n", ""],
  ["outOfStep: remote still checks the images", "  if (now.remote) { /* the engine runs on the host's own server: its images aren't this computer's to check */ }\n  else if", "  if"],
  ["outOfStep: Docker down read by truthiness (undefined too)", "else if (now.node === null) out.push(", "else if (!now.node) out.push("],
  ["outOfStep: the package's config digest not accepted", "if (now.node !== deployed.node && now.node !== deployed.nodeConfig)", "if (now.node !== deployed.node)"],
  ["outOfStep: relay checked against the node's config", "now.relay !== deployed.relay && now.relay !== deployed.relayConfig", "now.relay !== deployed.relay && now.relay !== deployed.nodeConfig"],
  ["outOfStep: no deploy says nothing", "if (!deployed) return [\"No deploy on record: can't tell whether the bridge, table and engine match.\"];", "if (!deployed) return [];"],
];

runMutations(path.join(ROOT, "bridge", "versions.js"), path.join(ROOT, "tests", "test_versions_golden.js"), MUTATIONS, process.argv[2]);
