// The friend package's builder (tools/make-friend-package.js), its pure parts: the save's stamp and new name, the
// refusals when the deploy record disagrees, the compose file, and reading a docker save tar.
//   node tests/test_friend_package.js
const { Readable } = require("stream");
const pack = require("../tools/make-friend-package");

let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why ? `: ${why}` : ""}\n`); } };
const same = (name, got, want) => ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// the save: TTS's own layout (CRLF, two-space indent, the script as one escaped string)
const save = '{\r\n  "SaveName": "Mock MTGA 4 player",\r\n  "GameMode": "MTG",\r\n  "LuaScript": "x = 1\\r\\nfunction engineStamp() return \\"0fa50b21\\" end\\r\\n",\r\n  "ObjectStates": [\r\n    {\r\n      "Nickname": "SaveName",\r\n      "Name": "Card"\r\n    }\r\n  ]\r\n}';
{
  same("stamp: read from the Global script", pack.stampOf(save), "0fa50b21");
  same("stamp: none in an old script", pack.stampOf('{"LuaScript":"x = 1"}'), null);
  const renamed = pack.renameSave(save, pack.SAVE_NAME);
  same("rename: the new name", JSON.parse(renamed).SaveName, "MTG Table (rules engine)");
  same("rename: every other byte kept", renamed.replace('"MTG Table (rules engine)"', '"Mock MTGA 4 player"'), save);
  same("rename: the stamp kept", pack.stampOf(renamed), "0fa50b21");
  same("rename: a name with quotes is escaped", JSON.parse(pack.renameSave(save, 'a "b"')).SaveName, 'a "b"');
  let threw = false;
  try { pack.renameSave('{"GameMode": "x"}', "y"); } catch { threw = true; }
  ok("rename: a file with no SaveName is refused", threw);
}

// refusals: one disagreement at a time
{
  const d = { bridge: "b1", table: "t1", save: "s1", node: "sha256:nnnnnnnnnnnnnnnnnnnn", relay: "sha256:rrrrrrrrrrrrrrrrrrrr" };
  const compose = "services:\n  relay:\n    image: mtg-relay:exile\n  forge-room:\n    image: mtg-forge-node:exile\n";
  const good = { deployed: d, tags: { node: d.node, relay: d.relay }, containers: { node: d.node, relay: d.relay }, save: { stamp: "t1", sha8: "s1" }, bridge: "b1", compose };
  const said = (change, opts) => pack.refusals({ ...good, ...change }, opts);
  same("refuse: nothing when all agree", said({}), []);
  const one = (name, change, word, opts) => { const r = said(change, opts); ok(`refuse: ${name}`, r.length === 1 && r[0].includes(word), JSON.stringify(r)); };
  same("refuse: no deploy record", said({ deployed: null }).length, 1);
  one("an image missing", { tags: { node: null, relay: d.relay } }, "missing");
  one("a tag moved", { tags: { node: "sha256:oooooooooooooooooooo", relay: d.relay } }, "tag moved");
  one("a container on another image", { containers: { node: d.node, relay: "sha256:oooooooooooooooooooo" } }, "running relay container");
  same("refuse: Docker can't say: both containers", said({ containers: { node: null, relay: null } }).length, 2);
  one("the save is another table", { save: { stamp: "t2", sha8: "s1" } }, "deploy again");
  one("the save was saved over", { save: { stamp: "t1", sha8: "s2" } }, "changed since the deploy");
  same("refuse: a saved-over save, allowed", said({ save: { stamp: "t1", sha8: "s2" } }, { allowChangedSave: true }), []);
  one("another table is refused even when saves may change", { save: { stamp: "t2", sha8: "s2" } }, "deploy again", { allowChangedSave: true });
  one("no save", { save: null }, "can't be read");
  one("bridge code not deployed", { bridge: "b2" }, "--allow-undeployed-bridge");
  same("refuse: undeployed bridge, allowed", said({ bridge: "b2" }, { allowUndeployedBridge: true }), []);
  one("compose runs another image", { compose: compose.replace("mtg-relay:exile", "mtg-relay:exile2") }, "doesn't run mtg-relay:exile");
}

// the compose file
{
  const y = pack.composeYaml();
  ok("compose: the project name", /^name: mtg-table$/m.test(y));
  ok("compose: no web client", !/^\s*web:/m.test(y) && !/8080/.test(y));
  same("compose: the two images", [...y.matchAll(/^\s*image: (\S+)$/gm)].map((m) => m[1]), ["mtg-relay:exile", "mtg-forge-node:exile"]);
  const ports = [...y.matchAll(/^\s*- "([^"]+)"/gm)].map((m) => m[1]);
  ok("compose: every port on 127.0.0.1", ports.length === 1 && ports.every((p) => p.startsWith("127.0.0.1:")), JSON.stringify(ports));
  ok("compose: the room the bridge asks for", /SELF_HOSTED_NODE_ROOM_NAME: "tts-commander"/.test(y));
}

// a docker save tar, read in odd-sized pieces
{
  const entry = (name, body, type = "0") => {
    const h = Buffer.alloc(512);
    h.write(name, 0);
    h.write(`${body.length.toString(8).padStart(11, "0")}\0`, 124);
    h.write(type, 156);
    h.write("ustar\0", 257);
    h.write("00", 263);
    return Buffer.concat([h, Buffer.from(body), Buffer.alloc((512 - (body.length % 512)) % 512)]);
  };
  const index = JSON.stringify({ manifests: [
    { digest: "sha256:aaa", annotations: { "io.containerd.image.name": "docker.io/library/mtg-relay:exile" } },
    { digest: "sha256:bbb", annotations: { "io.containerd.image.name": "docker.io/library/mtg-forge-node:exile" } }] });
  const manifest = JSON.stringify([{ Config: "blobs/sha256/ccc", RepoTags: ["mtg-relay:exile"] }, { Config: "blobs/sha256/ddd", RepoTags: ["mtg-forge-node:exile"] }]);
  const tar = Buffer.concat([entry("blobs/", "", "5"), entry("blobs/sha256/x", "z".repeat(1500)), entry("index.json", index), entry("manifest.json", manifest), entry("oci-layout", "{}"), Buffer.alloc(1024)]);
  const pieces = [];
  for (let at = 0, n = 7; at < tar.length; at += n, n = n * 3 % 1013 + 1) pieces.push(tar.subarray(at, at + n));
  pack.tarRead(Readable.from(pieces), ["index.json", "manifest.json"]).then(({ names, text }) => {
    same("tar: every entry", [...names], ["blobs/", "blobs/sha256/x", "index.json", "manifest.json", "oci-layout"]);
    same("tar: index.json read whole", text["index.json"], index);
    same("tar: the images by tag", pack.tarImages(text), { "mtg-relay:exile": { id: "sha256:aaa", config: "sha256:ccc" }, "mtg-forge-node:exile": { id: "sha256:bbb", config: "sha256:ddd" } });
  }).catch((e) => ok("tar", false, e.stack)).finally(() => {
    process.stdout.write(failed ? `\n${failed} friend package checks failed (${passed} passed)\n` : `all ${passed} friend package checks pass\n`);
    process.exit(failed ? 1 : 0);
  });
}
