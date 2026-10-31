// Bridge-side half of tools/tts-stutter-synth.lua: during its second minute, sends TTS one ~1.5 KB "noop" message
// a second through the External Editor port, the same way the bridge sends board updates.
const net = require("net");
const pad = "x".repeat(1500);
const send = () => new Promise((resolve) => {
  const s = net.connect(39999, "127.0.0.1", () => s.end(JSON.stringify({ messageID: 2, customMessage: { t: "noop", json: JSON.stringify({ t: "noop", pad }) } })));
  s.on("close", resolve); s.on("error", resolve);
});
(async () => {
  await new Promise((r) => setTimeout(r, 62000)); // skip the idle minute
  for (let i = 0; i < 58; i++) { await send(); await new Promise((r) => setTimeout(r, 1000)); }
  console.log("sent 58 messages");
})();
