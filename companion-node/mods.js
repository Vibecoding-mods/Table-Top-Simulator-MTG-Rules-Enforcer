// Loads the two decision modules. For breakit.js only, MTG_COMPANION_LOGIC / MTG_COMPANION_PLATFORM point at a broken
// copy of logic.js / platform.js, so the selftest runs against it and the real files are never edited. The copy is
// used only when all hold: breakit's marker MTG_COMPANION_BREAKIT=1, the file sits in a folder named mtg-breakit-*
// directly in the system temp folder, and the program running is selftest.js itself (never companion.js), so the
// companion a friend runs always loads its own files.
"use strict";
const os = require("os");
const path = require("path");

function overrideAllowed(env, file, tmpdir, mainFile) {
  if (!file || env.MTG_COMPANION_BREAKIT !== "1" || path.basename(mainFile || "") !== "selftest.js") return false;
  const f = path.resolve(file), dir = path.dirname(f);
  return path.dirname(dir) === path.resolve(tmpdir) && path.basename(dir).startsWith("mtg-breakit-") && f.endsWith(".js");
}
const pick = (envName, file) => {
  const alt = process.env[envName];
  const main = require.main ? require.main.filename : "";
  return require(overrideAllowed(process.env, alt, os.tmpdir(), main) ? path.resolve(alt) : path.join(__dirname, file));
};
module.exports = {
  logic: () => pick("MTG_COMPANION_LOGIC", "logic.js"),
  platform: () => pick("MTG_COMPANION_PLATFORM", "platform.js"),
  overrideAllowed,
};
