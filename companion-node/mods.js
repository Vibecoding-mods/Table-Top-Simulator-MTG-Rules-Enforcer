// Loads the two decision modules. MTG_COMPANION_LOGIC / MTG_COMPANION_PLATFORM point at another copy of logic.js /
// platform.js: breakit.js uses them to run the selftest against a broken copy, so the real files are never edited.
"use strict";
const path = require("path");
const pick = (envName, file) => require(process.env[envName] ? path.resolve(process.env[envName]) : path.join(__dirname, file));
module.exports = {
  logic: () => pick("MTG_COMPANION_LOGIC", "logic.js"),
  platform: () => pick("MTG_COMPANION_PLATFORM", "platform.js"),
};
