// No test reaches the live table: while this module is loaded, every TCP connection (net.connect, http.request, fetch,
// WebSocket: all go through net.Socket.prototype.connect) to a port the running game uses is refused and recorded,
// on any host, before anything leaves the process. Ports: 39999 (TTS's editor port, where the bridge sends), 39998
// (the bridge's own TTS port), 48787 (the bridge's debug port), 9443 (the relay).
// Why (live check 2026-11-11): a test drove a harness bridge after harness.restore() had put the real net.connect back,
// and its chat line ("All attack" would break a limit...) appeared in a real game's chat, once per gate run.
// At exit, a process that tried prints FAIL with where it came from and exits 1, whatever the test itself decided.
//   attempts()   what was refused so far: [{ port, host, from }]
//   block(port)  refuse one more port too (the harness's decoy TTS ports; the guard's self-test uses a spare port)
//   forget(port, from) drop that port's attempts from index `from` on (only a check that made them on purpose)
const net = require("net");

const LIVE_PORTS = Object.freeze([39999, 39998, 48787, 9443]);
const refused = new Set(LIVE_PORTS);
const tried = [];
const KEY = Symbol.for("mtg.noLivePorts");

// (net.connect hands connect() its normalized arguments as an array; a direct call passes (options) or (port, host))
function target(args) {
  const a = Array.isArray(args[0]) ? args[0] : args;
  const o = a[0];
  if (o && typeof o === "object") return { port: Number(o.port), host: o.host || "localhost" };
  return { port: Number(o), host: typeof a[1] === "string" ? a[1] : "localhost" };
}

if (!net.Socket.prototype.connect[KEY]) {
  const realConnect = net.Socket.prototype.connect;
  const guarded = function connect(...args) {
    const { port, host } = target(args);
    if (!refused.has(port)) return realConnect.apply(this, args);
    const from = (new Error().stack || "").split("\n").slice(2).filter((l) => !/node:|no-live-ports/.test(l)).slice(0, 4).map((l) => l.trim()).join(" | ");
    tried.push({ port, host, from });
    const e = Object.assign(new Error(`connect ECONNREFUSED ${host}:${port} (tests/no-live-ports.js: that is the live table's port)`), { code: "ECONNREFUSED", port, address: host });
    process.nextTick(() => this.destroy(e));
    return this;
  };
  guarded[KEY] = true;
  net.Socket.prototype.connect = guarded;
  process.on("exit", () => {
    if (!tried.length) return;
    for (const t of tried) process.stdout.write(`FAIL a test tried to reach the live table on ${t.host}:${t.port} (refused): ${t.from}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  LIVE_PORTS,
  attempts: () => tried.slice(),
  block: (port) => { refused.add(Number(port)); },
  unblock: (port) => { if (!LIVE_PORTS.includes(Number(port))) refused.delete(Number(port)); },
  forget: (port, from = 0) => { for (let i = tried.length - 1; i >= from; i--) if (tried[i].port === Number(port)) tried.splice(i, 1); },
};
