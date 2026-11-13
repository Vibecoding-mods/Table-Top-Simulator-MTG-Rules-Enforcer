// The container engine: Docker or Podman through its own command line. The package needs no compose: the two engine
// containers are started with plain `run` / `network` commands equal to stack/compose.yml (platform.runArgs).
"use strict";
const os = require("os");
const path = require("path");
const probes = require("./probes");
const P = require("./mods").platform();
const L = require("./mods").logic();

class Engine {
  // o: { project, platform, arch, override ("docker"|"podman"|null), log(line), key() -> the relay key }
  constructor(o) {
    this.o = o;
    this.runtime = null; // chosen at the first detect that finds one, then kept (the stack lives in it)
    this.cli = null;
  }

  desktopApp() {
    if (this.o.platform !== "darwin") return null;
    for (const a of ["/Applications/Docker.app", path.join(os.homedir(), "Applications", "Docker.app")]) if (probes.exists(a)) return a;
    return null;
  }

  async info(cli, runtime) {
    const r = await probes.run(cli, ["info", "--format", "{{json .}}"], { timeoutMs: 15000 });
    const i = r.code === 0 ? P.parseInfo(runtime, r.out) : null;
    const answers = !!(i && (runtime === "podman" || i.version));
    const last = String(r.out || "").trim().split("\n").filter((s) => s.trim()).pop() || (r.timedOut ? "no answer in 15 s" : null);
    return { answers, info: i, out: r.out, detail: answers ? null : last };
  }

  // The facts for logic.decideDocker, and the engine chosen
  async detect() {
    const dockerCli = probes.which("docker"), podmanCli = probes.which("podman"), desktop = this.desktopApp();
    let dockerProbe = null;
    if (dockerCli && this.o.override !== "podman" && this.runtime !== "podman") dockerProbe = await this.info(dockerCli, "docker");
    const runtime = P.chooseRuntime({ override: this.o.override, sticky: this.runtime, dockerFound: !!dockerCli, dockerAnswers: !!(dockerProbe && dockerProbe.answers), podmanFound: !!podmanCli, desktopFound: !!desktop });
    const f = { platform: this.o.platform, runtime, cliFound: false, desktopFound: !!desktop && runtime === "docker", answers: false, desktopRunning: false, waiting: false, waitedSec: 0, accessDenied: false, osType: null, version: null, cpus: 0, detail: null };
    if (!runtime) return f;
    const cli = runtime === "docker" ? dockerCli : podmanCli;
    f.cliFound = !!cli;
    if (cli) {
      const probe = runtime === "docker" && dockerProbe ? dockerProbe : await this.info(cli, runtime);
      f.answers = probe.answers;
      f.accessDenied = !probe.answers && P.accessDeniedText(probe.out);
      f.detail = probe.detail;
      if (probe.info) { f.osType = probe.info.osType; f.version = probe.info.version; f.cpus = probe.info.cpus; }
      if (probe.answers && this.runtime !== runtime) { this.runtime = runtime; this.cli = cli; this.o.log(`container engine: ${runtime} (${cli})${probe.info && probe.info.rootless ? ", rootless" : ""}`); }
      else if (probe.answers) this.cli = cli;
    }
    if (f.desktopFound) {
      const procs = await probes.processes();
      f.desktopRunning = procs.some((p) => /Docker Desktop|com\.docker\.backend/.test(p.cmd));
    }
    if (!this.cli && cli) { this.cli = cli; }
    if (!this.runtime && f.answers) this.runtime = runtime;
    return f;
  }

  startDesktop() {
    const app = this.desktopApp();
    if (!app) return false;
    this.o.log(`starting Docker Desktop: ${app}`);
    return probes.launch("open", ["-a", app]);
  }

  name(service) { return P.containerName(this.o.project, service); }

  async imageId(tag) {
    if (!this.cli) return { id: null, error: "no container engine" };
    const r = await probes.run(this.cli, ["image", "inspect", "--format", "{{.Id}}", tag], { timeoutMs: 20000 });
    if (r.code === 0) return { id: L.normId(r.out.trim().split("\n").pop()), error: null };
    if (P.noSuchText(r.out)) return { id: null, error: null };
    return { id: null, error: r.timedOut ? "the container engine didn't answer" : L.clip(r.out.trim(), 200) };
  }

  async container(service) {
    if (!this.cli) return { info: null, error: "no container engine" };
    const r = await probes.run(this.cli, ["container", "inspect", this.name(service)], { timeoutMs: 20000 });
    if (r.code === 0) {
      const info = P.containerFromInspect(r.out, L.normId);
      return info ? { info, error: null } : { info: null, error: "unreadable container inspect" };
    }
    if (P.noSuchText(r.out)) return { info: { exists: false }, error: null };
    return { info: null, error: r.timedOut ? "the container engine didn't answer" : L.clip(r.out.trim(), 200) };
  }

  async cmd(args, timeoutMs) {
    this.o.log(`${this.runtime || "engine"} ${args.map((a) => (/^-e$/.test(a) ? a : a.replace(/(KEY=).*/, "$1***"))).join(" ")}`);
    const r = await probes.run(this.cli, args, { timeoutMs: timeoutMs || 120000, onLine: (l) => this.o.log(`  ${l}`) });
    this.o.log(`  exit ${r.code}${r.timedOut ? " (timed out)" : ""}`);
    return r;
  }

  // `compose up -d`: the network, then each container run, started, or replaced when its image changed
  async up() {
    if (!this.cli) return { code: -1, out: "no container engine", timedOut: false };
    const net = P.networkName(this.o.project);
    const ni = await probes.run(this.cli, ["network", "inspect", net], { timeoutMs: 20000 });
    let out = "";
    if (ni.code !== 0) { const c = await this.cmd(["network", "create", net], 30000); out += c.out; if (c.code !== 0) return c; }
    for (const s of P.Services) {
      const { info, error } = await this.container(s);
      if (error) return { code: 1, out: error, timedOut: false };
      const tag = await this.imageId(P.Images[s]);
      const plan = P.upPlan(info, tag.id, L.sameId);
      let r = null;
      if (plan === "replace") { r = await this.cmd(["rm", "-f", this.name(s)], 60000); if (r.code !== 0) return r; }
      if (plan === "run" || plan === "replace") r = await this.cmd(P.runArgs(s, { project: this.o.project, runtime: this.runtime, key: this.o.key(), platform: this.o.platform, arch: this.o.arch }), 120000);
      else if (plan === "start") r = await this.cmd(["start", this.name(s)], 60000);
      if (r) { out += r.out; if (r.code !== 0) return r; }
    }
    return { code: 0, out, timedOut: false };
  }

  restart() { return this.cmd(["restart", ...P.Services.map((s) => this.name(s))], 120000); }
  stop() { return this.cmd(["stop", ...P.Services.map((s) => this.name(s))], 120000); }
  async down() {
    const r = await this.cmd(["rm", "-f", ...P.Services.map((s) => this.name(s))], 120000);
    await this.cmd(["network", "rm", P.networkName(this.o.project)], 30000);
    return r;
  }

  // `<cli> load -i <tar>`; progress(percent or -1, seconds)
  async load(tar, size, progress) {
    const t0 = Date.now();
    this.o.log(`${this.runtime} load -i ${tar} (${size >> 20} MB)`);
    const r = await probes.run(this.cli, ["load", "-i", tar], {
      timeoutMs: 90 * 60 * 1000, onLine: (l) => this.o.log(`load: ${l}`),
      onTick: (pid) => { const b = probes.bytesRead(pid); progress(b < 0 ? -1 : Math.min(99, Math.floor((b * 100) / Math.max(1, size))), Math.round((Date.now() - t0) / 1000)); },
    });
    this.o.log(`load: exit ${r.code}${r.timedOut ? " (timed out)" : ""} after ${Math.round((Date.now() - t0) / 1000)} s`);
    return r.code === 0 && !r.timedOut;
  }

  // what the bridge's own `docker ...` calls go through (shim/docker): the real CLI and the project
  bridgeEnv() {
    return { MTG_CONTAINER_CLI: this.cli || "", MTG_PROJECT: this.o.project };
  }
}

module.exports = { Engine };
