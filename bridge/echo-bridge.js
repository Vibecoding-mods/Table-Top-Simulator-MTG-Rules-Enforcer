// Echo bridge for the TTS latency test (SPEC.md §6, test 1).
// TTS → bridge: TTS connects to localhost:39998 and sends {"messageID":4,"customMessage":{...}} per sendExternalMessage.
// bridge → TTS: we connect to localhost:39999 and send {"messageID":2,"customMessage":{...}} → onExternalMessage.
// Run: node echo-bridge.js   (no dependencies; Node 18+)
const net = require("net");
const fs = require("fs");
const path = require("path");

const LISTEN_PORT = 39998; // TTS sends here (the port the VSCode/Atom plugin also wants)
const TTS_PORT = 39999; // TTS listens here

const bridgeMs = []; // time inside the bridge, receive → pong written

function sendToTTS(customMessage) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(TTS_PORT, "127.0.0.1", () => {
      sock.end(JSON.stringify({ messageID: 2, customMessage }));
    });
    sock.on("close", resolve);
    sock.on("error", reject);
  });
}

function percentile(sorted, p) {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function summarize(label, values) {
  const s = [...values].sort((a, b) => a - b);
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  return `${label}: n=${s.length} avg=${avg.toFixed(1)} p50=${percentile(s, 50).toFixed(1)} ` +
    `p95=${percentile(s, 95).toFixed(1)} p99=${percentile(s, 99).toFixed(1)} max=${s[s.length - 1].toFixed(1)} ms`;
}

async function handle(msg, receivedAt) {
  if (msg.messageID !== 4 || !msg.customMessage) return; // ignore script dumps, prints, errors, saves
  const m = msg.customMessage;
  if (m.t === "ping") {
    await sendToTTS({ t: "pong", id: m.id });
    bridgeMs.push(Number(process.hrtime.bigint() - receivedAt) / 1e6);
  } else if (m.t === "results") {
    const rtt = Object.values(m.ms).map(Number);
    const lines = [
      `Echo test ${new Date().toISOString()}`,
      summarize("TTS round trip (Lua os.clock)", rtt),
      summarize("Time inside bridge", bridgeMs),
      "Targets (SPEC §6): < 30 ms good, > 100 ms unplayable",
    ];
    console.log("\n" + lines.join("\n") + "\n");
    const out = path.join(__dirname, "latency-echo.csv");
    fs.writeFileSync(out, "ping,rtt_ms\n" + rtt.map((v, i) => `${i + 1},${v.toFixed(3)}`).join("\n") + "\n");
    console.log(`Wrote ${out}`);
    bridgeMs.length = 0;
  } else if (m.t === "hello") {
    console.log("TTS connected: echo script loaded.");
  }
}

const server = net.createServer((sock) => {
  const chunks = [];
  sock.on("data", (c) => chunks.push(c));
  sock.on("end", () => {
    const receivedAt = process.hrtime.bigint();
    const text = Buffer.concat(chunks).toString("utf8").trim();
    if (!text) return;
    let msg;
    try { msg = JSON.parse(text); } catch { return console.warn("Unparseable message from TTS:", text.slice(0, 200)); }
    handle(msg, receivedAt).catch((e) => console.error("Send to TTS failed (is a game loaded?):", e.message));
  });
  sock.on("error", () => {});
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Port ${LISTEN_PORT} is taken. Close the VSCode/Atom TTS plugin (or anything else using it) and retry.`);
  } else console.error(e);
  process.exit(1);
});

server.listen(LISTEN_PORT, "127.0.0.1", () => {
  console.log(`Echo bridge listening on ${LISTEN_PORT}. In TTS, load the echo script and type "echotest" in chat.`);
});
