// The Linux/macOS friend package's builder (tools/make-friend-package-unix.js): its tar writer, the launchers, and the
// promise that everything a friend runs is readable as shipped (the companion's .js files byte for byte, no minified,
// packed or encoded code, launchers a few lines of shell).
//   node tests/test_friend_package_unix.js                         the pure parts
//   node tests/test_friend_package_unix.js <MTG-Table-*.tar.gz>... also a built package (with SHASUMS256.txt: --sums F)
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { Writable, Readable } = require("stream");
const { execFileSync } = require("child_process");
const pack = require("../tools/make-friend-package-unix");
const win = require("../tools/make-friend-package"); // (tableCopies: the check both builders run before writing)

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const COMPANION = path.join(__dirname, "..", "companion-node");
const walk = (dir, rel = "") => fs.readdirSync(path.join(dir, rel)).sort().flatMap((f) => (fs.statSync(path.join(dir, rel, f)).isDirectory() ? walk(dir, `${rel}${f}/`) : [`${rel}${f}`]));
const collect = () => { const parts = []; const w = new Writable({ write(c, _e, cb) { parts.push(c); cb(); } }); w.bytes = () => Buffer.concat(parts); return w; };
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const SYSTAR = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";

async function pure() {
  // ── the tar writer
  same("ustar split: a short name as is", pack.splitName("a/b.json"), ["", "a/b.json"]);
  const long = `MTG-Table-linux-x64-2026-11-12/manabrew/public/preset_decks/${"x".repeat(80)}.json`;
  const sp = pack.splitName(long);
  ok("ustar split: a long name at a slash, name <= 100, prefix <= 155", sp && sp[0].length <= 155 && sp[1].length <= 100 && `${sp[0]}/${sp[1]}` === long, JSON.stringify(sp));
  ok("ustar split: a 120-character file name can't be split: PAX", pack.splitName(`d/${"y".repeat(120)}`) === null);
  ok("ustar split: a non-ASCII name: PAX", pack.splitName("decks/Ætherflux.json") === null);
  const rec = pack.paxRecord("path", "decks/Ætherflux.json");
  ok("PAX record: its length counts itself, in bytes", Number(rec.toString("utf8").split(" ")[0]) === rec.length, rec.toString("utf8"));
  ok("PAX record: a length that crosses a digit (9 -> 10 bytes...)", [1, 2, 3, 90, 95, 96, 97, 990, 994, 995].every((n) => { const r = pack.paxRecord("p", "v".repeat(n)); return Number(r.toString("utf8").split(" ")[0]) === r.length; }));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-unix-pkg-test-"));
  try {
    const big = crypto.randomBytes(70000);
    fs.writeFileSync(path.join(tmp, "big.bin"), big);
    const entries = [
      { name: "P/start.sh", mode: 0o755, data: Buffer.from("#!/bin/sh\necho hi\n") },
      { name: "P/runtime/node/bin/node", mode: 0o755, file: path.join(tmp, "big.bin") },
      { name: "P/empty.txt", mode: 0o644, data: Buffer.alloc(0) },
      { name: "P/exact.txt", mode: 0o644, data: Buffer.alloc(512, 65) },
      { name: `P/${"z".repeat(120)}.json`, mode: 0o644, data: Buffer.from("{}") },
      { name: "P/decks/Ætherflux.json", mode: 0o644, data: Buffer.from("[1]") },
      { name: long.replace(/^MTG-Table-linux-x64-2026-11-12/, "P"), mode: 0o644, data: Buffer.from("long") },
      { name: "P/logs/", dir: true },
    ];
    const w = collect();
    await pack.writeTarGz(entries, w, { mtime: 1700000000 });
    const back = await pack.readTarGz(Readable.from([w.bytes()]));
    const files = Object.fromEntries(back.filter((e) => e.type === "0").map((e) => [e.name, e]));
    ok("tar: every file comes back under its full name", entries.filter((e) => !e.dir).every((e) => files[e.name]), Object.keys(files).join(", "));
    ok("tar: the bytes come back (a 70 KB file from disk, an empty one, one of exactly 512)", files["P/runtime/node/bin/node"]?.data.equals(big) && files["P/empty.txt"]?.size === 0 && files["P/exact.txt"]?.data.equals(Buffer.alloc(512, 65)));
    ok("tar: node and start.sh are 0755, the rest 0644", files["P/start.sh"]?.mode === 0o755 && files["P/runtime/node/bin/node"]?.mode === 0o755 && files["P/empty.txt"]?.mode === 0o644);
    const dirs = back.filter((e) => e.type === "5").map((e) => e.name);
    ok("tar: the folders are there, before what they hold, 0755, and the empty logs/", ["P/", "P/runtime/", "P/runtime/node/", "P/runtime/node/bin/", "P/decks/", "P/logs/"].every((d) => dirs.includes(d)) && back.filter((e) => e.type === "5").every((e) => e.mode === 0o755) && back.findIndex((e) => e.name === "P/runtime/node/bin/") < back.findIndex((e) => e.name === "P/runtime/node/bin/node"), dirs.join(", "));
    // a real tar program reads it the same way (Windows' bsdtar here, GNU tar or bsdtar on the friend's side)
    if (fs.existsSync(SYSTAR) || process.platform !== "win32") {
      const f = path.join(tmp, "t.tar.gz");
      fs.writeFileSync(f, w.bytes());
      const list = execFileSync(SYSTAR, ["-tvzf", f], { encoding: "utf8" });
      ok("tar.exe lists it: start.sh and node rwxr-xr-x", /-rwxr-xr-x[^\n]*P\/start\.sh/.test(list) && /-rwxr-xr-x[^\n]*P\/runtime\/node\/bin\/node/.test(list), list);
      ok("tar.exe lists it: the long and the PAX names whole", list.includes(`P/${"z".repeat(120)}.json`) && list.includes(long.replace(/^MTG-Table-linux-x64-2026-11-12/, "P")), list);
      const x = path.join(tmp, "x");
      fs.mkdirSync(x);
      execFileSync(SYSTAR, ["-xzf", f, "-C", x]);
      ok("tar.exe extracts it byte for byte", fs.readFileSync(path.join(x, "P", "runtime", "node", "bin", "node")).equals(big) && fs.readFileSync(path.join(x, "P", "decks", "Ætherflux.json"), "utf8") === "[1]" && fs.statSync(path.join(x, "P", "logs")).isDirectory());
    }
    const bad = Buffer.from(w.bytes());
    const raw = require("zlib").gunzipSync(bad); raw[0] ^= 1;
    let threw = false;
    try { await pack.readTarGz(Readable.from([require("zlib").gzipSync(raw)])); } catch { threw = true; }
    ok("tar reader: a header with a wrong checksum is an error", threw);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

  // ── the launchers: a few lines of shell that run only the bundled node on companion/companion.js
  for (const p of Object.keys(pack.PLATFORMS)) {
    const l = pack.launchers(p);
    const names = Object.keys(l);
    same(`launchers ${p}: the names`, names, pack.PLATFORMS[p].os === "darwin" ? ["MTG Companion.command", "Stop MTG.command"] : ["start.sh", "stop.sh"]);
    for (const [n, text] of Object.entries(l)) {
      const code = text.split("\n").filter((x) => x.trim() && !x.startsWith("#"));
      ok(`launcher ${p} ${n}: #!/bin/sh, LF, under 12 lines`, text.startsWith("#!/bin/sh\n") && !text.includes("\r") && text.split("\n").length <= 12, text);
      ok(`launcher ${p} ${n}: only cd to its folder and exec the bundled node on companion/companion.js`, code.length === 2 && code[0] === 'cd "$(dirname "$0")" || exit 1' && /^exec \.\/runtime\/node\/bin\/node companion\/companion\.js( "\$@"| --stop "\$@")$/.test(code[1]), code.join(" | "));
      ok(`launcher ${p} ${n}: no download, decode or eval`, !/curl|wget|base64|eval|\|\s*(sh|bash)\b/.test(code.join("\n")));
    }
  }

  // ── the companion: every file of companion-node byte for byte, readable
  const want = walk(COMPANION);
  const comp = pack.companionEntries(COMPANION, { "page.html": "<html>", "release-keys.txt": "k\n" });
  same("companion: every file of companion-node, under companion/, plus page.html and the public key", comp.map((e) => e.name).sort(), [...want.map((f) => `companion/${f}`), "companion/page.html", "companion/release-keys.txt"].sort());
  ok("companion: byte for byte", want.every((f) => comp.find((e) => e.name === `companion/${f}`).data.equals(fs.readFileSync(path.join(COMPANION, f)))));
  ok("companion: the shim is 0755, the .js files 0644 (run by node, not by themselves)", comp.find((e) => e.name === "companion/shim/docker").mode === 0o755 && comp.filter((e) => e.name.endsWith(".js")).every((e) => e.mode === 0o644));
  ok("companion: plain .js files only, no node_modules, no package.json, no binaries", want.every((f) => /\.(js|txt)$/.test(f) || f === "shim/docker") && !want.some((f) => /node_modules|package\.json|\.(node|exe|wasm|zip|gz)$/.test(f)), want.join(", "));
  const unread = want.flatMap((f) => pack.unreadable(f, fs.readFileSync(path.join(COMPANION, f), "utf8")));
  ok("companion: no minified line, base64 blob, eval or CR in any file", unread.length === 0, unread.join("; "));
  ok("companion: it requires only Node's built-ins and its own files", want.filter((f) => f.endsWith(".js")).every((f) => [...fs.readFileSync(path.join(COMPANION, f), "utf8").matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)].every((m) => m[1].startsWith("./") || require("module").builtinModules.includes(m[1].replace(/^node:/, "")))));
  ok("companion: its README says the folder is the source itself, not bundled", /IS its source/.test(fs.readFileSync(path.join(COMPANION, "README.txt"), "utf8")) && /Nothing is compiled, bundled, minified/.test(fs.readFileSync(path.join(COMPANION, "README.txt"), "utf8")));
  ok("companion: its README names every .js file", want.filter((f) => f.endsWith(".js")).every((f) => fs.readFileSync(path.join(COMPANION, "README.txt"), "utf8").includes(path.basename(f))));
  // the checker itself catches what it is for
  ok("readable check: a minified line", pack.unreadable("a.js", `x=1;${"a.b;".repeat(300)}`).length === 1);
  ok("readable check: a base64 blob", pack.unreadable("a.js", `const c = "${crypto.randomBytes(300).toString("base64")}";`).length === 1);
  ok("readable check: eval and new Function", pack.unreadable("a.js", "eval(x)").length === 1 && pack.unreadable("a.js", "new Function(x)").length === 1);
  ok("readable check: CR line ends in a shell script", pack.unreadable("start.sh", "#!/bin/sh\r\necho\r\n").length === 1 && pack.unreadable("a.js", "x\r\n").length === 0);
  ok("readable check: a .min.js file", pack.unreadable("x.min.js", "x").length === 1);

  // ── the Node runtime: chosen by name, checked by sha256 and by its binary header (never run)
  const elf = Buffer.alloc(64); elf.writeUInt32BE(0x7f454c46, 0); elf.writeUInt16LE(0x3e, 18);
  const macArm = Buffer.alloc(64); macArm.writeUInt32LE(0xfeedfacf, 0); macArm.writeUInt32LE(0x0100000c, 4);
  const macX = Buffer.alloc(64); macX.writeUInt32LE(0xfeedfacf, 0); macX.writeUInt32LE(0x01000007, 4);
  same("binary: ELF x86-64", pack.binaryKind(elf), { os: "linux", arch: "x64" });
  same("binary: Mach-O arm64 and x86-64", [pack.binaryKind(macArm), pack.binaryKind(macX)], [{ os: "darwin", arch: "arm64" }, { os: "darwin", arch: "x64" }]);
  same("binary: a Windows exe is nothing here", pack.binaryKind(Buffer.concat([Buffer.from("MZ"), Buffer.alloc(62)])), { os: "?", arch: "?" });
  const sums = "aaaa  node-v24.22.1.tar.gz\n" + `${"b".repeat(64)}  node-v24.22.1-linux-x64.tar.xz\n${"c".repeat(64)}  node-v24.22.1-linux-x64.tar.xz.extra\n`;
  same("SHASUMS256.txt: the exact file's line", pack.shasumFor(sums, "node-v24.22.1-linux-x64.tar.xz"), "b".repeat(64));
  same("SHASUMS256.txt: not listed", pack.shasumFor(sums, "node-v24.22.1-darwin-arm64.tar.gz"), null);
  const nd = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-node-names-"));
  try {
    for (const f of ["node-v24.22.1-linux-x64.tar.xz", "node-v24.9.0-linux-x64.tar.xz", "node-v24.22.1-darwin-arm64.tar.gz", "node-v24.22.1-linux-arm64.tar.xz"]) fs.writeFileSync(path.join(nd, f), "");
    ok("node archive: the newest for the platform (24.22.1 over 24.9.0), not arm64 Linux", pack.findNodeArchive(nd, "linux-x64").version === "v24.22.1" && path.basename(pack.findNodeArchive(nd, "linux-x64").file) === "node-v24.22.1-linux-x64.tar.xz");
    ok("node archive: macOS arm64 found, x64 missing", pack.findNodeArchive(nd, "macos-arm64") && pack.findNodeArchive(nd, "macos-x64") === null);
  } finally { fs.rmSync(nd, { recursive: true, force: true }); }

  // ── the READMEs
  const v = { built: "2026-11-12T00:00:00Z", bridge: "b1", table: "t1", saveName: "MTG Table (rules engine)", nodeVersion: "v24.22.1", folder: "MTG-Table-linux-x64-2026-11-12", arch: "x64" };
  const lin = pack.readmeLinux(v), macA = pack.readmeMac({ ...v, arch: "arm64" }), macI = pack.readmeMac({ ...v, arch: "x64" });
  for (const [n, t] of [["Linux", lin], ["Mac arm64", macA], ["Mac x64", macI]]) {
    ok(`README ${n}: points at the companion's source and says it is the source itself`, t.includes("companion/README.txt") && t.includes("IS the companion's source") && /Nothing in this folder is encrypted, compiled, minified or obfuscated/.test(t));
    ok(`README ${n}: the official Node and how to check it`, t.replace(/\s+/g, " ").includes("official Node.js v24.22.1") && t.includes("nodeArchive") && t.includes("--selftest"));
    ok(`README ${n}: no Windows instructions`, !/\.exe|C:\\|Docker Desktop: https.*\n.*docker-users|Unblock/.test(t));
    ok(`README ${n}: lines under 120 characters`, t.split("\n").every((x) => x.length <= 120), t.split("\n").find((x) => x.length > 120));
  }
  ok("README Linux: Steam Deck Desktop Mode, Dolphin, Konsole, podman info, ./start.sh", ["Switch to Desktop", "Dolphin", "Konsole", "podman info", "./start.sh", "./stop.sh"].every((s) => lin.includes(s)));
  ok("README Linux: both places TTS keeps its saves", lin.includes("~/.local/share/Tabletop Simulator/Saves") && lin.includes("Proton"));
  ok("README Mac arm64: Rosetta; Intel: none", macA.includes("Rosetta") && !macI.includes("Rosetta"));
  for (const [n, t] of [["Linux", lin], ["Mac", macA]]) {
    ok(`README ${n}: HOST REQUIREMENTS, cores and RAM as estimates`, /^HOST REQUIREMENTS/m.test(t) && /4 CPU cores and 16 GB of RAM recommended[\s\S]*estimates/.test(t) && t.includes("friends who only join need just TTS"));
    ok(`README ${n}: both Workshop tables to subscribe to, made from the host's own copy`, t.includes("https://steamcommunity.com/sharedfiles/filedetails/?id=2296042369") && t.includes("https://steamcommunity.com/sharedfiles/filedetails/?id=2293586471") && t.includes("makes the table from your Workshop copy") && !t.includes("copies the table"));
  }

  // ── the package's entries as the Workshop-copy check reads them: inside the folder, the whole text of a file that starts like JSON
  {
    const e = pack.tableCheckEntries([{ name: "P/table/make-table.js", data: Buffer.from("x") }, { name: "P/decks/a.json", data: Buffer.from('{"SaveName": "x", "ObjectStates": []}') }, { name: "P/logs/", dir: true }], "P");
    same("table check entries: paths inside the folder, a JSON file's text, no folders", e.map((x) => [x.rel, x.text]), [["table/make-table.js", undefined], ["decks/a.json", '{"SaveName": "x", "ObjectStates": []}']]);
    same("table check entries: a TTS save among them is caught", win.tableCopies(e), ["decks/a.json"]);
    const big = pack.tableCheckEntries([{ name: "P/table/MTG Table.json", data: Buffer.alloc(200000, 32) }], "P");
    ok("table check entries: a table/ JSON is caught by name, whatever it holds", big[0].text === undefined && win.tableCopies(big).length === 1);
    const far = Buffer.from(`{"SaveName": "x", "LuaScript": "${"-".repeat(200000)}", "ObjectStates": []}`);
    const deep = pack.tableCheckEntries([{ name: "P/decks/renamed.txt", data: far }], "P");
    same("table check entries: a save whose ObjectStates is past 64 KB, under another name and extension, is caught", win.tableCopies(deep), ["decks/renamed.txt"]);
  }
  ok("README Linux and Mac: the token is readable by other accounts; stop refuses mid-game, --force", [lin, macA].every((t) => t.includes("access token can be read by other accounts") && t.includes("--force")));
  ok("README Mac: Docker Desktop, the .command, the unsigned-launcher step", ["Docker Desktop", "MTG Companion.command", "right-click it > Open", "Stop MTG.command"].every((s) => macA.includes(s)));
  ok("SOURCE.txt: the images are linux/amd64, Node's licence from its archive", /linux\/amd64/.test(pack.sourceText({ images: ["a", "b"], manabrewCommit: "m", forgeCommit: "f", nodeVersion: "v1", patches: { manabrew: "1", forge: "2" } })));
}

// a built package: what the friend gets
async function built(file, sumsFile) {
  const tag = path.basename(file);
  const top = tag.replace(/\.tar\.gz$/, "");
  const plat = Object.keys(pack.PLATFORMS).find((p) => top.startsWith(`MTG-Table-${p}-`));
  ok(`${tag}: named MTG-Table-<platform>-<date>.tar.gz`, !!plat && /-\d{4}-\d\d-\d\d$/.test(top));
  if (!plat) return;
  const P = pack.PLATFORMS[plat];
  const keep = (n) => !/\/images\/|\/bridge\/(forge-cards|image-cache|token-scripts|forge-planes)|\/(decks|manabrew|scenarios)\//.test(n);
  const entries = await pack.readTarGz(fs.createReadStream(file), keep);
  const by = Object.fromEntries(entries.map((e) => [e.name.slice(top.length + 1), e]));
  ok(`${tag}: one top folder named as the archive`, entries.every((e) => e.name.startsWith(`${top}/`)));
  const want = walk(COMPANION);
  ok(`${tag}: the companion is companion-node byte for byte`, want.every((f) => by[`companion/${f}`]?.data?.equals(fs.readFileSync(path.join(COMPANION, f)))), want.filter((f) => !by[`companion/${f}`]?.data?.equals(fs.readFileSync(path.join(COMPANION, f)))).join(", "));
  ok(`${tag}: nothing else in companion/ but page.html and release-keys.txt`, Object.keys(by).filter((n) => n.startsWith("companion/") && !n.endsWith("/")).every((n) => want.includes(n.slice(10)) || n === "companion/page.html" || n === "companion/release-keys.txt"));
  ok(`${tag}: the public key only`, !/PRIVATE/.test(by["companion/release-keys.txt"]?.data?.toString() || ""));
  ok(`${tag}: page.html is the status page`, /\{\{TOKEN\}\}/.test(by["companion/page.html"]?.data?.toString() || ""));
  const launch = P.os === "darwin" ? ["MTG Companion.command", "Stop MTG.command"] : ["start.sh", "stop.sh"];
  ok(`${tag}: the launchers, 0755, as the builder's`, launch.every((n) => by[n]?.mode === 0o755 && by[n].data.toString() === pack.launchers(plat)[n]));
  ok(`${tag}: node and the shim 0755`, by["runtime/node/bin/node"]?.mode === 0o755 && by["companion/shim/docker"]?.mode === 0o755);
  const node = by["runtime/node/bin/node"]?.data;
  const kind = node ? pack.binaryKind(node.subarray(0, 64)) : {};
  ok(`${tag}: node is a ${P.os}/${P.arch} binary`, kind.os === P.os && (kind.arch === P.arch || kind.arch === "universal"), JSON.stringify(kind));
  const v = JSON.parse(by["version.json"]?.data?.toString() || "{}");
  ok(`${tag}: version.json: the platform, the node archive and the contract's keys`, v.platform === plat && v.companion === "node" && ["bridge", "table", "save", "node", "relay", "built", "saveName", "composeProject"].every((k) => v[k]) && v.nodeArchive?.sha256?.length === 64);
  if (sumsFile) ok(`${tag}: the node archive's sha256 is the one nodejs.org lists`, pack.shasumFor(fs.readFileSync(sumsFile, "utf8"), v.nodeArchive?.file || "-") === v.nodeArchive?.sha256);
  if (sumsFile && node) {
    // the shipped binary is the archive's own bin/node (extract it again, compare)
    const arch = path.join(path.dirname(sumsFile), v.nodeArchive.file);
    if (fs.existsSync(arch)) {
      const x = fs.mkdtempSync(path.join(os.tmpdir(), "mtg-node-x-"));
      try {
        const inner = `${v.nodeArchive.file.replace(/\.tar\.(xz|gz)$/, "")}/bin/node`;
        execFileSync(SYSTAR, ["-x", "-f", arch, "-C", x, inner]);
        ok(`${tag}: runtime/node/bin/node is the archive's bin/node byte for byte`, sha(fs.readFileSync(path.join(x, inner))) === sha(node));
      } finally { fs.rmSync(x, { recursive: true, force: true }); }
    }
  }
  const shell = launch.concat(["companion/shim/docker"]).flatMap((n) => pack.unreadable(n, by[n]?.data?.toString() || ""));
  const js = Object.keys(by).filter((n) => /\.(js|html)$/.test(n)).flatMap((n) => pack.unreadable(n, by[n].data.toString("utf8")));
  ok(`${tag}: every script and page shipped is readable (no minified line, base64 blob, eval)`, shell.length === 0 && js.length === 0, [...shell, ...js].slice(0, 5).join("; "));
  ok(`${tag}: no *.min.js, no node_modules`, !Object.keys(by).some((n) => /\.min\.js$|node_modules/.test(n)));
  ok(`${tag}: the README for ${P.os}, pointing at the source`, (by[P.readme]?.data?.toString() || "").includes("companion/README.txt"));
  ok(`${tag}: bridge, the table's patcher, stack, LICENSES, logs/`, ["bridge/bridge.js", "bridge/versions.js", "table/make-table.js", "table/make-engine-copy.js", "table/README.txt", "stack/compose.yml", "stack/deployed.json", "LICENSES/SOURCE.txt", "LICENSES/Node-LICENSE.txt", "LICENSES/LICENSE", "logs/"].every((n) => by[n]));
  const img = entries.find((e) => e.name === `${top}/images/mtg-images.tar`);
  ok(`${tag}: images/mtg-images.tar (unless built --no-images)`, v.imagesFile === null || (img && img.size > 100e6), img ? img.size : "none");
  const copies = win.tableCopies(Object.keys(by).filter((n) => by[n]?.data).map((n) => ({ rel: n, text: win.jsonText(by[n].data.subarray(0, 64), by[n].data.length, () => by[n].data) })));
  same(`${tag}: no copy of a Workshop table in it`, copies, []);
  ok(`${tag}: version.json names the Workshop table the companion makes the table from`, v.workshop?.id === "2296042369" && v.tables?.[0]?.id === "2296042369");
}

(async () => {
  await pure();
  const args = process.argv.slice(2);
  const si = args.indexOf("--sums");
  const sums = si >= 0 ? args.splice(si, 2)[1] : null;
  for (const f of args) await built(path.resolve(f), sums && path.resolve(sums));
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
