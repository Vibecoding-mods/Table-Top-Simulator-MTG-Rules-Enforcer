// The process that runs the bridge and restarts it 3 s after any exit (the Windows app's BridgeLoop, Program.cs). It
// is its own process (started detached by the companion with --bridge-loop), so closing the companion never touches a
// game. One loop per package: <logs>/bridge-loop.pid. Stop: SIGTERM to the loop, which stops the bridge and exits.
"use strict";
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const probes = require("./probes");

const pidFile = (layout) => path.join(layout.logsDir, "bridge-loop.pid");
const stamp = () => new Date().toISOString().replace("T", " ").slice(0, 19);

function line(log, text) { try { fs.appendFileSync(log, `${text}\n`); } catch { /* the bridge's own lines matter more */ } }

// the pid of this package's running loop, or null. The file's pid counts only while that process is still this
// package's loop: after a reboot the number can belong to anything, which must never be stopped or waited for.
function loopPid(layout) {
  const pid = Number(probes.readText(pidFile(layout)));
  if (!Number.isInteger(pid) || pid <= 0 || !probes.alive(pid)) return null;
  return require("./mods").platform().isLoopCmd(probes.commandOf(pid), layout.home) ? pid : null;
}

// Runs until stopped. env: what the bridge gets on top of this process's (MTG_HOME, MTG_LOG_DIR, the shim's PATH).
// The bridge runs with Node's diagnostic reports on, and a report prints the whole environment and command line: so a
// server's key never comes in either, only the name of its file (MTG_KEY_FILE, Controller.serverEnv).
function run(layout, nodeExe, env) {
  fs.mkdirSync(layout.logsDir, { recursive: true });
  const other = loopPid(layout);
  if (other && other !== process.pid) return 0; // one loop at a time
  fs.writeFileSync(pidFile(layout), String(process.pid));
  const reports = path.join(layout.logsDir, "node-reports");
  let child = null, stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    if (child) { try { child.kill("SIGTERM"); } catch { /* gone */ } }
    setTimeout(() => { if (child) { try { child.kill("SIGKILL"); } catch { /* gone */ } } line(layout.bridgeLog, `[companion: bridge stopped at ${stamp().slice(11)}]`); cleanup(); process.exit(0); }, child ? 3000 : 0);
  };
  const cleanup = () => { try { if (Number(probes.readText(pidFile(layout))) === process.pid) fs.unlinkSync(pidFile(layout)); } catch { /* gone */ } };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("SIGHUP", () => {}); // (the terminal that started the companion closing must not stop a game)
  const once = () => {
    if (stopping) return;
    try {
      const st = fs.statSync(layout.bridgeLog);
      if (st.size > 20 * 1024 * 1024) { try { fs.unlinkSync(`${layout.bridgeLog}.1`); } catch { /* none */ } fs.renameSync(layout.bridgeLog, `${layout.bridgeLog}.1`); }
    } catch { /* no log yet */ }
    line(layout.bridgeLog, `[companion: starting the bridge at ${stamp()}]`);
    let fd;
    try { fd = fs.openSync(layout.bridgeLog, "a"); } catch (e) { line(layout.bridgeLog, `[companion: can't open the log: ${e.message}]`); setTimeout(once, 3000); return; }
    try {
      child = spawn(nodeExe, ["--report-on-fatalerror", "--report-uncaught-exception", `--report-directory=${reports}`, layout.bridgeJs],
        { cwd: path.dirname(layout.bridgeJs), env: { ...process.env, ...env }, stdio: ["ignore", fd, fd] });
    } catch (e) { child = null; line(layout.bridgeLog, `[companion: couldn't start node: ${e.message}]`); }
    fs.closeSync(fd);
    if (!child) { setTimeout(once, 3000); return; }
    child.on("error", (e) => line(layout.bridgeLog, `[companion: couldn't start node: ${e.message}]`));
    child.on("exit", (code, signal) => {
      child = null;
      if (stopping) return;
      line(layout.bridgeLog, `[bridge exited with code ${code === null ? signal : code} at ${stamp().slice(11)}; restarting in 3 s]`);
      setTimeout(once, 3000);
    });
  };
  once();
  return null; // (keeps running)
}

// Stops this package's loop and its bridge (and a bridge of this package started by hand)
async function stop(layout) {
  const pid = loopPid(layout);
  if (pid) {
    probes.kill([pid], "SIGTERM");
    for (let i = 0; i < 30 && loopPid(layout) === pid; i++) await new Promise((r) => setTimeout(r, 200));
  }
  const P = require("./mods").platform();
  const left = P.bridgeProcs(await probes.processes(), layout.bridgeJs).map((p) => p.pid).filter((p) => p !== process.pid);
  probes.kill(left, "SIGTERM");
}

module.exports = { run, stop, loopPid, pidFile };
