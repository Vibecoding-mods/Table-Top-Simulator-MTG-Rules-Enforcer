// Break-its for the big-turns-2 engine work, run in a harness test image (no local Java needed). Each mutation switches
// one piece off in a COPY of one file (the trees are never written), the image compiles only that copy over the patched
// build (engine/checks/mutate-in-image.sh) and runs the test class, and the named check must fail.
//   node tools/mutate-engine-docker.js --harness <manabrew tree> --forge <forge tree> [--proto <generated protocol dir>]
//        [--image mtg-harness-test:l2-ai] [--set tie|tokens|runaway|held|watchdog|all] [--only <label regex>]
// Heavy: run it through tmp/slot.js's queue (it does so itself when MTG_SLOT is set to slot.js's path).
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const HARNESS = arg("harness"), FORGE = arg("forge"), PROTO = arg("proto"), IMAGE = arg("image", "mtg-harness-test:l2-ai");
const SET = arg("set", "all"), only = arg("only") ? new RegExp(arg("only"), "i") : null;
const PATCH = path.join(__dirname, "..", "engine", "forge.patch");
if (!HARNESS || !FORGE) { console.log("usage: --harness <manabrew tree> --forge <forge tree>"); process.exit(2); }

const H = "forge-harness/src/main/java/forge/harness/host/";
const G = "forge-game/src/main/java/forge/game/";
// set: [label, tree (mb | forge), file, from, to, test class, check that must fail]
const SETS = {
  tie: [
    ["the offer doesn't wait for the last player who can lose", "mb", H + "TieOffer.java", "if (waitUntilOneCanLose && game.getPlayers()", "if (false && game.getPlayers()", "TieOfferTest", "multiplayer: one lock among three waits until one player can lose"],
    ["the wait can't be switched off", "mb", H + "TieOffer.java", "        this.waitUntilOneCanLose = waitUntilOneCanLose;", "        this.waitUntilOneCanLose = true;", "TieOfferTest", "multiplayer: with the wait off one lock offers at once"],
    ["decking doesn't break a lock", "mb", H + "TieOffer.java", "        if (deckingBreaksLock && !out.isEmpty()", "        if (false && !out.isEmpty()", "TieOfferTest", "decking: a player who can deck out is no lock"],
    ["decking breaks a lock even with no loss to an empty library", "mb", H + "TieOffer.java", " && !player.cantLoseCheck(GameLossReason.Milled)) {", ") {", "TieOfferTest", "decking: a player who can't lose to an empty library keeps the lock"],
  ],
  tokens: [],
  runaway: [],
  held: [],
  watchdog: [],
};

// the cloud's tie-offer break-its (tools/mutate-tie-offer-engine.js needs a local JDK), read from that file as they are
SETS["tie-cloud"] = (() => {
  const src = fs.readFileSync(path.join(__dirname, "mutate-tie-offer-engine.js"), "utf8");
  const body = src.slice(src.indexOf("const MUTATIONS = [") + "const MUTATIONS = [".length, src.indexOf("\n];", src.indexOf("const MUTATIONS = [")));
  return new Function("H", "T", `return [${body}];`)(H, H + "TieOffer.java").map(([label, file, from, to, name]) => [label, "mb", file, from, to, "TieOfferTest", name]);
})();
const list = (SET === "all" ? Object.values(SETS).flat() : SETS[SET] || []).filter((m) => !only || only.test(m[0]));
if (!list.length) { console.log(`no mutations in set ${SET}`); process.exit(2); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-engine-"));
const classes = [...new Set(list.map((m) => m[5]))];
const dirs = [];
classes.forEach((cls, i) => { const d = path.join(tmp, `m${String(i).padStart(3, "0")}`); fs.mkdirSync(d); fs.writeFileSync(path.join(d, "class"), cls); dirs.push({ d, base: true, cls }); });
let notApplied = 0;
list.forEach((m, i) => {
  const [label, tree, file, from, to, cls] = m;
  const src = fs.readFileSync(path.join(tree === "mb" ? HARNESS : FORGE, file), "utf8");
  const crlf = src.includes("\r\n"), text = src.replace(/\r\n/g, "\n");
  if (text.split(from).length !== 2) { notApplied++; console.log(`NOT APPLIED ${label}`); return; }
  const d = path.join(tmp, `m${String(500 + i).padStart(3, "0")}`);
  const out = path.join(d, "src", file.replace(/^.*?src\/main\/java\//, ""));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const next = text.replace(from, to);
  fs.writeFileSync(out, crlf ? next.replace(/\n/g, "\r\n") : next);
  fs.writeFileSync(path.join(d, "class"), cls);
  dirs.push({ d, m });
});
const win = (p) => p.replace(/\\/g, "/");
const docker = ["docker", "run", "--rm",
  "-v", `${win(path.join(HARNESS, "forge-harness"))}:/src:ro`, "-v", `${win(FORGE)}:/fsrc:ro`, "-v", `${win(PATCH)}:/forge.patch:ro`,
  ...(PROTO ? ["-v", `${win(PROTO)}:/proto:ro`] : []), "-v", `${win(tmp)}:/mut`,
  "-v", `${win(path.join(__dirname, "..", "engine", "checks", "mutate-in-image.sh"))}:/mutate.sh:ro`, "--entrypoint", "sh", IMAGE, "/mutate.sh"];
const cmd = process.env.MTG_SLOT ? ["node", process.env.MTG_SLOT, ...docker] : docker;
const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 1 << 26 });
if (r.status !== 0) { console.log(`${r.stdout}${r.stderr}`.slice(-4000)); process.exit(1); }
const fails = (d) => { const f = path.join(d, "result"); const t = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "NO RESULT"; return { t, names: t.split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5)) }; };
let bad = 0;
for (const x of dirs.filter((x) => x.base)) {
  const { t, names } = fails(x.d);
  if (names.length || !/^PASS /m.test(t)) { bad++; console.log(`BASELINE FAILS ${x.cls}: ${names.join(" | ") || t.slice(-400)}`); }
}
let caught = 0;
for (const x of dirs.filter((x) => x.m)) {
  const [label, , , , , , name] = x.m;
  const { t, names } = fails(x.d);
  const hit = names.some((n) => n.startsWith(`${name}:`) || n === name);
  if (hit) caught++;
  console.log(`${hit ? "caught  " : "MISSED  "} ${label}: ${names.join(" | ").slice(0, 300) || (/COMPILE ERROR/.test(t) ? "COMPILE ERROR " + t.split("\n")[0] : "nothing failed")}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
const total = dirs.filter((x) => x.m).length;
console.log(`${caught} of ${total} caught by name${notApplied ? `, ${notApplied} not applied` : ""}; the trees were not written`);
process.exit(bad || notApplied || caught !== total ? 1 : 0);
