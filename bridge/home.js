// Where the bridge finds its data and keeps its logs. Unset, everything is where it always was: the repo (bridge/..),
// logs and state in its tmp/, the console and game logs beside this file. The friend package
// (tools/make-friend-package.js) has the repo's layout; its MTG Companion starts the bridge with MTG_HOME=<package>
// and MTG_LOG_DIR=<package>\logs. Env:
//   MTG_HOME     the folder holding decks/, manabrew/public/preset_decks/, stack/ and scenarios/ (default bridge/..)
//   MTG_LOG_DIR  logs and state (bridge-game.json, table-log.log, backups, ...) instead of <home>/tmp, and
//                tts-console.log and game-log.txt instead of bridge/
const fs = require("fs");
const path = require("path");

const HOME = process.env.MTG_HOME ? path.resolve(process.env.MTG_HOME) : path.join(__dirname, "..");
const LOG_DIR = process.env.MTG_LOG_DIR ? path.resolve(process.env.MTG_LOG_DIR) : null;
const data = (...parts) => path.join(HOME, ...parts); // what the repo (or the package) holds
const tmp = (...parts) => path.join(LOG_DIR || data("tmp"), ...parts); // what the bridge writes
// (the bridge appends and saves without checking: a missing folder loses every line and the resume file. A package
// has no tmp/, so it is made when either variable is set; the repo's is left alone)
if (LOG_DIR || process.env.MTG_HOME) fs.mkdirSync(tmp(), { recursive: true });
const beside = (...parts) => path.join(LOG_DIR || __dirname, ...parts); // logs the repo keeps in bridge/

module.exports = { HOME, LOG_DIR, data, tmp, beside };
