// Drives headless Edge over CDP: loads the real companion status page (127.0.0.1:48790), optionally replaces the
// /api/status and /api/tools answers with example states (states.js), and saves PNG clips.
// usage: start the companion first, read-only:  "MTG Companion.exe" --observe --no-browser  (port 48790), then
//        node shoot.js <outDir>   (the PDF: msedge --headless=new --no-pdf-header-footer --print-to-pdf=OUT tutorial.html)
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const S = require("./states.js");

const OUT = process.argv[2];
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = 9334;
const PROFILE = path.join(require("os").tmpdir(), "mtg-tutorial-edge-prof");
const URL0 = "http://127.0.0.1:48790/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const edge = spawn(EDGE, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, "--no-first-run", "--disable-extensions", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  let list;
  for (let i = 0; i < 50; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (list.some((t) => t.type === "page")) break; } catch {}
    await sleep(200);
  }
  const page = list.find((t) => t.type === "page");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  let fakeStatus = null, fakeTools = null, realTools = null;
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    if (m.method === "Fetch.requestPaused") {
      const { requestId, request } = m.params;
      let body = null;
      if (request.url.endsWith("/api/status") && fakeStatus) body = fakeStatus;
      if (request.url.endsWith("/api/tools") && request.method === "GET" && fakeTools) body = fakeTools;
      if (body) {
        await send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: [{ name: "Content-Type", value: "application/json; charset=utf-8" }, { name: "Cache-Control", value: "no-store" }], body: Buffer.from(JSON.stringify(body)).toString("base64") });
      } else await send("Fetch.continueRequest", { requestId });
    }
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 1400, deviceScaleFactor: 2, mobile: false });
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/status*" }, { urlPattern: "*/api/tools*" }] });
  const evalJs = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result.value;

  async function load(status, tools) {
    fakeStatus = status; fakeTools = tools;
    await send("Page.navigate", { url: URL0 });
    await sleep(3500);
  }
  // clip from the top of element a to the bottom of element b (ids), full width of .wrap
  async function shot(name, fromSel, toSel, pad = 12) {
    const r = await evalJs(`(function(){var w=document.querySelector('.wrap').getBoundingClientRect();var a=document.querySelector(${JSON.stringify(fromSel)}).getBoundingClientRect();var b=document.querySelector(${JSON.stringify(toSel)}).getBoundingClientRect();return {x:w.left,y:a.top+window.scrollY,w:w.width,h:b.bottom-a.top};})()`);
    const clip = { x: Math.max(0, r.x), y: Math.max(0, r.y - pad), width: r.w, height: r.h + pad * 2, scale: 1 };
    const res = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: true });
    fs.writeFileSync(path.join(OUT, name + ".png"), Buffer.from(res.data, "base64"));
    console.log("wrote", name, Math.round(clip.width), "x", Math.round(clip.height));
  }

  // 1. the real page, unmodified (observe mode on this PC), and its real Table tools (the real bridge's /tools)
  await load(null, null);
  await shot("real-page", "header.top", "footer", 16);
  await evalJs("document.getElementById('tablebox').open=true; 1");
  await sleep(2500);
  realTools = await evalJs("fetch('/api/tools',{headers:{'X-MTG-Token':document.getElementById('mtg-token').content}}).then(function(r){return r.json()})");
  await shot("real-tools", "#tablebox", "#tablebox", 6);

  // 2. example states in friend mode
  const plan = [
    ["ready", S.ready, ["header.top", "#toast"]],
    ["first-start", S.firstStart, ["header.top", "#hint"]],
    ["tts-amber", S.ttsAmber, ["header.top", "#hint"]],
    ["tts-notrunning", S.ttsNotRunning, ["#lights", "#lights"]],
    ["red-stack", S.redStack, ["header.top", "#lights"]],
    ["red-docker", S.redDocker, ["header.top", "#lights"]],
    ["game-on", S.gameOn, ["#game", "#toast"]],
    ["update", S.update, ["header.top", "#update"]],
    ["not-public", S.notPublic, ["#update", "#update"]],
  ];
  for (const [name, st, [a, b]] of plan) { await load(st, null); await shot(name, a, b); }
  // the actions row alone (friend mode, no game)
  await load(S.ready, null);
  await shot("actions", "#tools-h", "#tools");
  await evalJs("document.getElementById('logbox').open=true; 1"); await sleep(600);
  await shot("log", "#logbox", "footer");

  // 3. table tools with debug tools on, example seats (presets list is the real bridge's)
  await load(S.ready, S.toolsOn(realTools));
  await evalJs("document.getElementById('tablebox').open=true; 1");
  await sleep(2500);
  await shot("tools-on", "#tablebox", "#tablebox", 6);
  // a pasted deck list for one seat
  await evalJs("(function(){var s=document.querySelectorAll('#tt-seats select');var k=s[6],d=s[7];k.value='forge';k.dispatchEvent(new Event('change'));d.value='__list';d.dispatchEvent(new Event('change'));var ta=document.querySelectorAll('#tt-seats textarea')[3];ta.value='Commander\\n1 Neheb, the Worthy\\n\\nDeck\\n1 Lightning Bolt\\n1 Sol Ring\\n1 Mountain';return 1})()");
  await sleep(300);
  await shot("tools-list", "#tt-seats .tt-seat:nth-child(4)", "#tt-seats .tt-seat:nth-child(4)", 8);
  await shot("tools-seat-red", "#tt-seats .tt-seat:nth-child(2)", "#tt-seats .tt-seat:nth-child(2)", 8);
  await shot("tools-debug", "#tablebox h3:nth-of-type(2)", "#tt-toast", 8);

  ws.close();
  edge.kill();
}
main().catch((e) => { console.error(e); process.exit(1); });
