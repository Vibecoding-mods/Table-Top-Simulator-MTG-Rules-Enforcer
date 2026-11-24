// Grades tests/test_editor_forward_golden.js (the bridge/editor-forward.js golden master) with
// tools/mutate-golden-lib.js: each mutation below is a plausible careless change, weighted to offer()'s routing and to
// the Save & Play guard (the one that keeps a reload from wiping the player's table); the golden must go red by name.
//   node tools/mutate-editor-forward-golden.js [label pattern]
// First pass 2026-11-24: 35 of 36 caught (2.8%, SOUND), 1 skipped (its `from` text was wrong). The escape (the queue
// kept when the plugin is down) and the skipped one (the queue kept on close) both needed messages still queued when
// it happens; two scenarios added, both caught now.
const path = require("path");
const { runMutations } = require("./mutate-golden-lib");

const ROOT = path.join(__dirname, "..");

// [label, from, to, equivalent?]: `from` must occur exactly once in editor-forward.js
const MUTATIONS = [
  ["port: 65535 refused (< becomes <=)", "n > 0 && n < 65536 ? n : 0", "n > 0 && n < 65535 ? n : 0"],
  ["port: ?? becomes || (an option 0 falls to the env)", "let forwardPort = port(opts.forwardPort ?? env.MTG_EDITOR_FORWARD_PORT);", "let forwardPort = port(opts.forwardPort || env.MTG_EDITOR_FORWARD_PORT);"],
  ["clash: forward = bridge port not checked", "if (forwardPort && (forwardPort === ttsInPort || forwardPort === ttsPort)) {", "if (forwardPort && (forwardPort === ttsPort)) {"],
  ["clash: command = forward not checked", " || commandPort === ttsPort || commandPort === forwardPort)) {", " || commandPort === ttsPort)) {"],
  ["offer: our table's custom message goes to the plugin too", "if (msg.customMessage && typeof msg.customMessage.t === \"string\") return true;", "if (msg.customMessage && typeof msg.customMessage.t === \"string\") { send(raw()); return true; }"],
  ["offer: customMessage truthiness dropped (?. instead)", "if (msg.customMessage && typeof msg.customMessage.t === \"string\") return true;", "if (typeof msg.customMessage?.t !== \"undefined\") return true;"],
  ["offer: >= becomes > at the bridge's exec range", "if (Number(msg.returnID) >= BRIDGE_EXEC_BASE) return true;", "if (Number(msg.returnID) > BRIDGE_EXEC_BASE) return true;"],
  ["offer: returnID compared without Number()", "if (Number(msg.returnID) >= BRIDGE_EXEC_BASE) return true;", "if (msg.returnID >= BRIDGE_EXEC_BASE && typeof msg.returnID === \"number\") return true;"],
  ["offer: object created (7) also to the bridge", "if (id === 0 || id === 6 || id === 7) { send(raw()); return false; }", "if (id === 0 || id === 6) { send(raw()); return false; }"],
  ["offer: Get Scripts window <= becomes <", "now() - getScriptsAt <= getScriptsMs", "now() - getScriptsAt < getScriptsMs"],
  ["offer: Get Scripts answer not reset (every later game loaded is the plugin's)", "        getScriptsAt = 0;\n        send(raw());", "        send(raw());"],
  ["offer: the text as received ignored", "(typeof text === \"string\" && text ? text : JSON.stringify(msg))", "JSON.stringify(msg)"],
  ["send: queue cap >= becomes >", "if (queue.length >= maxQueue) { queue.shift(); stats.dropped++; }", "if (queue.length > maxQueue) { queue.shift(); stats.dropped++; }"],
  ["send: drops the newest instead of the oldest", "if (queue.length >= maxQueue) { queue.shift(); stats.dropped++; }", "if (queue.length >= maxQueue) { stats.dropped++; return; }"],
  ["attempt: EADDRNOTAVAIL not refused", "if (e.code === \"ECONNREFUSED\" || e.code === \"EADDRNOTAVAIL\") refused = true;", "if (e.code === \"ECONNREFUSED\") refused = true;"],
  ["attempt: host not sticky (always the first)", "hostAt = (h + 1) % hosts.length;", "hostAt = 0;"],
  ["attempt: queue kept when the plugin is down", "        stats.dropped += 1 + queue.length;\n        queue.length = 0;", "        stats.dropped += 1;"],
  ["send: down window < becomes <=", "if (now() < downUntil) { stats.dropped++; return; }", "if (now() <= downUntil) { stats.dropped++; return; }"],
  ["isRunning: a throwing check counts as not running", "function isRunning() { try { return !!gameRunning(); } catch { return true; } }", "function isRunning() { try { return !!gameRunning(); } catch { return false; } }"],
  ["default gameRunning: unknown = not running", "const gameRunning = opts.gameRunning || (() => true);", "const gameRunning = opts.gameRunning || (() => false);"],
  ["save&play: no second running check after the table check", "    if (isRunning()) return \"a game started while the table was checked\";\n", ""],
  ["save&play: an error answer read as safe", "if (!r || r.error || r.timeout) return", "if (!r || r.timeout) return"],
  ["save&play: a timeout read as safe", "if (!r || r.error || r.timeout) return", "if (!r || r.error) return"],
  ["save&play: the player's cards only above 300 chars of text cut differently", "${String(r.value).slice(0, 300)}", "${String(r.value)}"],
  ["save&play: relayed before the backup", "    try { log(`editor forward: save backed up to ${await backupSave()}`); } catch (e) { return `couldn't back up the save first (${e.message})`; }\n", "    backupSave().then((p) => log(`editor forward: save backed up to ${p}`), () => {});\n"],
  ["save&play: the in-progress flag never cleared", "    } finally { saveChecking = false; }", "    } finally { }"],
  ["save&play: Get Scripts not forgotten before the reload", "      getScriptsAt = 0; // its \"game loaded\" is a real reload: the bridge needs it\n", ""],
  ["command: Get Scripts time not taken", "    if (id === 0) getScriptsAt = now();\n", ""],
  ["command: > becomes >= on the size cap", "if (size > maxCommandBytes) {", "if (size >= maxCommandBytes) {"],
  ["command: not trimmed before relaying", "    relayToTTS(trimmed);\n  }", "    relayToTTS(text);\n  }"],
  ["start: the first host's error not passed on", "        if (i === 0) firstErr = e;\n", ""],
  ["close: queue kept", "    closed = true;\n    queue.length = 0;", "    closed = true;"],
  ["backup: overwrite allowed (no COPYFILE_EXCL)", "await fs.promises.copyFile(savePath, to, fs.constants.COPYFILE_EXCL); return to;", "await fs.promises.copyFile(savePath, to); return to;"],
  ["backup: the name not padded", ".map((n) => String(n).padStart(2, \"0\")).join(\"-\");", ".map((n) => String(n)).join(\"-\");"],
  ["backup: an error other than EEXIST tries the next name", "catch (e) { if (e.code !== \"EEXIST\") throw e; }", "catch (e) { }"],
  ["backup: month off by one", "d.getMonth() + 1, d.getDate()", "d.getMonth(), d.getDate()"],
  ["TABLE_CHECK_LUA: libcard counted as the player's", " and gm ~= \"testcard\" and gm ~= \"libcard\" then", " and gm ~= \"testcard\" then"],
];

runMutations(path.join(ROOT, "bridge", "editor-forward.js"), path.join(ROOT, "tests", "test_editor_forward_golden.js"), MUTATIONS, process.argv[2]);
