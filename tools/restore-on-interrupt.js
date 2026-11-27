// Put a mutated source file back when a mutation run is interrupted. The in-place mutators write the broken text into
// bridge.js / engine-renderer.lua / teams.js (and the companion mutators' tools/*.js and companion-node files) and put
// the pristine text back in a `finally` after the test; Ctrl+C or a crash inside spawnSync skips that, and the next
// run's baseline then takes the mutated file for the pristine one (or it gets committed). Require this first in a
// mutator (before it takes spawnSync from child_process). It covers writes made through fs.writeFileSync only, and
// only while the process can still run its handlers: a hard kill (SIGKILL, taskkill /F, power loss) is NOT caught,
// and on Windows SIGTERM/SIGHUP handlers may not run either; check git status after such a stop:
//   require("./restore-on-interrupt");
// It remembers the first text of every source file the process overwrites (a .js/.lua/.java/.patch/.cs/.sh outside
// tmp/, which already exists), and writes that text back (1) on exit, (2) on SIGINT/SIGTERM/SIGHUP, and (3) when a
// child run came back killed by SIGINT: the synchronous mutators never reach a signal handler, but the Ctrl+C that
// stops the process group also stops the test they are waiting on, so spawnSync/execFileSync report that signal.
// (golden-lib's runMutations has its own copy of this by sha256.)
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const firstText = new Map();
const watched = (p) => typeof p === "string" && /\.(js|lua|java|patch|cs|sh)$/.test(p) && !/[\\/]tmp[\\/]/.test(path.resolve(p));

const realWrite = fs.writeFileSync;
fs.writeFileSync = function (file, ...rest) {
  if (watched(file) && !firstText.has(file)) {
    try { firstText.set(file, fs.readFileSync(file)); } catch { /* a new file: nothing to put back */ }
  }
  return realWrite.call(fs, file, ...rest);
};

function restoreAll() {
  for (const [file, text] of firstText) {
    try { if (!fs.readFileSync(file).equals(text)) realWrite.call(fs, file, text); } catch { /* gone: nothing to do */ }
  }
}
const interrupted = () => { restoreAll(); process.exit(130); };
process.on("exit", restoreAll);
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, interrupted);

// (Windows reports a Ctrl+C'd child as exit code 0xC000013A, POSIX shells as 130, Node as the signal)
const ctrlC = (r) => !!r && (r.signal === "SIGINT" || r.status === 130 || r.status === 3221225786 || r.status === -1073741510);
const wrap = (name) => {
  const real = cp[name];
  cp[name] = function (...args) {
    let r;
    try { r = real.apply(cp, args); } catch (e) { if (ctrlC(e)) interrupted(); throw e; }
    if (ctrlC(r)) interrupted();
    return r;
  };
};
wrap("spawnSync");
wrap("execFileSync");
wrap("execSync");

module.exports = { restoreAll };
