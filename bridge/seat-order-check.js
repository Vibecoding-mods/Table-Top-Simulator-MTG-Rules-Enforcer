// Headless check of the relay's StartGame seat_order (2026-10-25: turns go clockwise as the seats sit).
// Three players join a room in the order A, B, C; A (the controller) starts with seat_order [C, A, B] and the
// relay's GameStarted must list them in that order. With --plain it starts without seat_order: join order.
//   node bridge/seat-order-check.js --relay ws://127.0.0.1:9444 --room seat-test [--plain]
const fs = require("fs");
const { presetFile } = require("./presets");

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const RELAY = arg("relay", "ws://127.0.0.1:9444");
const ROOM = arg("room", "seat-test");
const KEY = process.env.MANABREW_SERVER_KEY || "tts-local";
const PLAIN = process.argv.includes("--plain");
const tag = Math.random().toString(36).slice(2, 6);
const names = ["a", "b", "c"].map((x) => `tts-seat-${x}-${tag}`);
const BAD = process.argv.includes("--bad");
const wanted = PLAIN || BAD ? names : [names[2], names[0], names[1]];

function deck() {
  const p = JSON.parse(fs.readFileSync(presetFile("test_rules_tax"), "utf8"));
  const card = (e) => ({ identity: { name: e.name, setCode: "", cardNumber: "" }, manaCost: "", cmc: 0, types: [], subtypes: [], supertypes: [], colorIdentity: [], text: "", uris: {} });
  const cards = [];
  let commander = null;
  for (const e of p.cards) {
    if (p.commander && e.name === p.commander && !commander) { commander = card(e); continue; }
    for (let k = 0; k < (e.count || 1); k++) cards.push(card(e));
  }
  return { deck_name: p.label, deck: { name: p.label, cards, sideboard: [], format: "commander", commanders: commander ? [commander] : [] }, commander_name: p.commander || null };
}

let done = false;
const finish = (ok, why) => { if (done) return; done = true; console.log(`${ok ? "PASS" : "FAIL"} ${why}`); process.exit(ok ? 0 : 1); };
setTimeout(() => finish(false, "timed out"), 60000);

const clients = [];
function join(i) {
  const ws = new WebSocket(RELAY);
  const send = (m) => ws.send(JSON.stringify(m));
  const c = { ws, send, joined: false };
  clients[i] = c;
  ws.addEventListener("open", () => send({ type: "Authenticate", username: names[i], password: KEY, service: false, client_platform: "unknown", engine_gate: "unknown", client_version: "3.56.0" }));
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "AuthResult") send({ type: "ListRooms" });
    else if (m.type === "RoomList" && !c.roomId) {
      const room = m.rooms.find((r) => r.room_name === ROOM);
      if (!room) return finish(false, `room ${ROOM} not found`);
      c.roomId = room.room_id;
      send({ type: "JoinRoom", room_id: c.roomId, observe: false, as_bot: false });
    } else if (m.type === "RoomUpdate" && m.room.room_id === c.roomId) {
      if (!c.joined && m.room.players.some((p) => p.username === names[i])) {
        c.joined = true;
        const d = deck();
        send({ type: "SetDeckSelection", deck_name: d.deck_name, deck: d.deck, commander_name: d.commander_name });
        send({ type: "SetReady", ready: true });
        if (i + 1 < names.length) join(i + 1);
      }
      const ready = m.room.players.filter((p) => p.ready && p.connected).length;
      if (i === 0 && !c.started && m.room.status === "Lobby" && ready >= names.length) {
        c.started = true;
        console.log(`joined ${m.room.players.map((p) => p.username).join(", ")}; starting with ${PLAIN ? "no seat_order" : `seat_order ${wanted.join(", ")}`}`);
        send({ type: "StartGame", format: "Commander", ...(PLAIN ? {} : { seat_order: BAD ? [names[1], "someone-else", names[0]] : wanted }) });
      }
    } else if (m.type === "GameStarted") {
      const got = m.player_order;
      finish(JSON.stringify(got) === JSON.stringify(wanted), `player_order ${got.join(", ")} (wanted ${wanted.join(", ")})`);
    } else if (m.type === "Error") console.log("relay error", m.code, m.message);
  });
}
join(0);
