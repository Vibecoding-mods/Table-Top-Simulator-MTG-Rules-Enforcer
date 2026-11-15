// Lag spikes between the table and the bridge (the user, 2026-11-15: "when someone lags out or lag spike the game bugs
// out"). Two ways a host frame hitch broke a game, each made safe here:
// 1. The table's 5 s watchdog sends a message again the old way when its web request hasn't answered, and after a hitch
//    the bridge has both copies (bridge-live.log, 2026-11-14 22:29 group game: Blue's "play Boseiju" at 2505.5 s and
//    again at 2511.7 s). The table numbers each message (sid, q; make-engine-copy.js engineSend): the web request in
//    headers, the old way beside t and json. A second copy is dropped (bridge.js seenFromTable): here an answer to the
//    first step of a step-by-step question (a scry's top/bottom per card has the same choices each step) that, sent
//    twice, answered the second step too. Unnumbered messages (an older table) go through as before; a new load (sid)
//    counts from 1 again.
// 2. A message TTS doesn't take within 10 s is dropped (pump); a question with it, and the game waited for an answer to a
//    question nobody saw. Once TTS takes a message again, the running game is sent again (resendToTable, as after a
//    table reload), its open questions with it.
//   node tests/test_bridge_lag.js
const net = require("net");
const harness = require("./bridge-harness");

let failed = 0, passed = 0;
// (writes to stdout directly: the harness replaces console.log while a bridge is loaded)
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; process.stdout.write(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 400)}` : ""}\n`); } };

// a game with Blue seated against an AI, drawn by the table; Blue's question is two steps with the same choices
function setup(h) {
  const seat = new h.B.Seat("Blue", "neheb_minotaur_commander");
  seat.slot = "player-0";
  h.B._setGame({ seats: new Map([["Blue", seat]]), bots: 1, total: 2, playerOrder: ["tts-Blue-ab12", "self-hosted-node-77-bot"],
    slotNames: { "player-0": "Blue", "player-1": "AI 1" }, slotColor: { "player-0": "Blue", "player-1": "White" },
    started: true, closing: false, fromTable: true, sentStatic: {}, sentZones: {} });
  const calls = [];
  seat.respond = (promptId, type, out) => calls.push({ promptId, type, out });
  const ui = (n) => h.B.prepareUi({ title: `Card ${n}: top or bottom?`, mode: "single", options: [{ id: "top", label: "Top" }, { id: "bottom", label: "Bottom" }] });
  seat.prompt = { promptId: 50, type: "scry", ui: ui(1),
    toOutput: (a) => ({ __next: { ui: ui(2), toOutput: (b) => ({ type: "scryDecision", picks: [a[0], b[0]] }) } }) };
  return { seat, calls };
}
const answer = (choice, extra = {}) => ({ t: "answer", json: JSON.stringify({ color: "Blue", promptId: 50, choice: [choice] }), ...extra });
// the bridge's web endpoint, as the table's web request reaches it (headers and body)
function web(h, body, headers = {}) {
  const handler = h.B.debugServer.listeners("request")[0];
  const on = {};
  const req = { method: "POST", url: "/msg", headers: { host: "127.0.0.1:48787", ...headers }, setEncoding() {}, on(ev, fn) { on[ev] = fn; return req; }, destroy() {} };
  handler(req, { writeHead() {}, end() {} });
  on.data(JSON.stringify(body));
  on.end();
}

(async () => {
  // 1a. the old way twice (same number): the second copy is dropped
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    h.B.onTTS(answer("top", { sid: "load-1", q: 7 })); await h.flush();
    ok("copy: (the first answer opens the second step)", calls.length === 0 && seat.prompt?.ui?.title === "Card 2: top or bottom?", seat.prompt?.ui?.title);
    h.B.onTTS(answer("top", { sid: "load-1", q: 7 })); await h.flush();
    ok("copy: a second copy of the answer doesn't answer the next step", calls.length === 0 && seat.prompt?.ui?.title === "Card 2: top or bottom?", JSON.stringify(calls));
    ok("copy: the bridge log says it dropped it", h.effects.some((e) => e.log && /dropped a second copy of the table's answer \(#7\)/.test(e.log)), h.effects.filter((e) => e.log).map((e) => e.log).slice(-3).join(" | "));
    h.B.onTTS(answer("bottom", { sid: "load-1", q: 8 })); await h.flush();
    ok("copy: the next message (next number) answers the second step", calls.length === 1 && JSON.stringify(calls[0].out.picks) === '["top","bottom"]', JSON.stringify(calls));
    harness.restore();
  }
  // 1b. by web first (number in the headers), then the watchdog's copy the old way
  {
    const h = harness.load();
    const { seat, calls } = setup(h);
    web(h, answer("top"), { "x-mtg-sid": "load-2", "x-mtg-seq": "3" }); await h.flush();
    ok("web then old way: (the web answer opens the second step)", seat.prompt?.ui?.title === "Card 2: top or bottom?", seat.prompt?.ui?.title);
    h.B.onTTS(answer("top", { sid: "load-2", q: 3 })); await h.flush();
    ok("web then old way: the old way's copy is dropped", calls.length === 0 && seat.prompt?.ui?.title === "Card 2: top or bottom?", JSON.stringify(calls));
    // a reloaded table counts from 1 again under a new sid: its messages go through
    web(h, answer("bottom"), { "x-mtg-sid": "load-3", "x-mtg-seq": "3" }); await h.flush();
    ok("web then old way: a new load's same number is a new message", calls.length === 1, JSON.stringify(calls));
    harness.restore();
  }
  // 1c. unnumbered (a table from before): both copies go through, as before
  {
    const h = harness.load();
    const { calls } = setup(h);
    h.B.onTTS(answer("top")); await h.flush();
    h.B.onTTS(answer("top")); await h.flush();
    ok("unnumbered: an older table's messages are not dropped", calls.length === 1, JSON.stringify(calls));
    harness.restore();
  }

  // 2. a message TTS doesn't take within 10 s: the game is sent again once TTS takes one
  {
    const h = harness.load();
    const { seat } = setup(h);
    const stub = net.connect;
    // TTS stuck: the connection opens but the message is never taken; the 10 s timeout ends it
    let timeout = null;
    net.connect = () => {
      const sock = { handlers: {}, on(ev, fn) { this.handlers[ev] = fn; return this; }, setTimeout(ms, fn) { timeout = fn; return this; },
        destroy() { const c = this.handlers.close; if (c) c(); }, end() {} };
      return sock;
    };
    h.B.toTTS({ t: "prompt", color: "Blue", promptId: 50, title: "Card 1: top or bottom?", options: [] });
    await h.flush();
    ok("missed: (the send waits on TTS)", typeof timeout === "function", typeof timeout);
    net.connect = stub; // TTS is back
    timeout(); await h.flush();
    ok("missed: the bridge log says so", h.effects.some((e) => e.log && /TTS didn't take a prompt message within 10 s/.test(e.log)), "");
    const mark = h.effects.length;
    h.B.toTTS({ t: "chat", text: "[MTG] hello again" }); await h.flush();
    const after = h.effects.slice(mark).filter((e) => e.tts).map((e) => e.tts);
    ok("missed: once TTS takes a message, the game goes to it again", after.some((m) => m.t === "started"), after.map((m) => m.t).join(","));
    ok("missed: Blue's open question with it", after.some((m) => m.t === "prompt" && m.color === "Blue" && m.promptId === 50), after.map((m) => `${m.t}${m.promptId ? "#" + m.promptId : ""}`).join(","));
    const mark2 = h.effects.length;
    h.B.toTTS({ t: "chat", text: "[MTG] and again" }); await h.flush();
    ok("missed: only once", !h.effects.slice(mark2).some((e) => e.tts?.t === "started"), "");
    void seat;
    harness.restore();
  }

  process.stdout.write(failed ? `\n${failed} failed, ${passed} passed\n` : `PASSED: ${passed} passed, 0 failed\n`);
  process.exit(failed ? 1 : 0);
})();
