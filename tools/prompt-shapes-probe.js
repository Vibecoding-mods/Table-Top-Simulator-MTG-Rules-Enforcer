// The prompt-shapes probe (docs/handoff/prompt-shapes-report.md): each question shape the ability sweep never drove end
// to end (engine -> bridge -> table), played on the real harness (ManaBrewEngineAdapter through
// engine/checks/HeadlessGameServer.java, no relay or node images) with the real bridge.js between the engine and a fake
// table (tests/bridge-harness.js: no TTS, fake clock), as tools/m6-stream.js plays a recording.
// Three people: White (the bridge's seat: every question to White goes through the bridge, and what the table is shown
// and what the bridge answers are recorded), Blue and Red (answered here as headless-six.js does). Per shape: a fresh
// game, played to the caster's first main phase; the cards made with an apply_state (as a debug setup is); the card cast
// (or played, or activated); then every question until the stack is empty again. The table's answer is the first legal
// option unless the shape says which.
// Recorded per question White is asked: the engine's type and title, what the table shows (title, text, options), what
// was answered and what the bridge sent the engine. Flagged: a question the bridge answered by itself, one it showed
// nothing for (a hang), an option or title with a raw id (engine-card-, player-, prompt-action-), an answer the engine
// refused.
//   node tools/prompt-shapes-probe.js <engine tree with its harness jar> [--shape <name>] [--out tmp/prompt-shapes.json]
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawn, spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
// (the probe's own waits on the real clock: tests/bridge-harness.js replaces setTimeout while a bridge is loaded)
const realTimeout = setTimeout;
const sleep = (ms) => new Promise((r) => realTimeout(r, ms));
const harness = require(path.join(ROOT, "tests", "bridge-harness"));
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : def; };
const TREE = path.resolve(process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : path.join(os.homedir(), "engine"));
const ONLY = arg("shape", null);
const OUT = arg("out", path.join(ROOT, "tmp", "prompt-shapes.json"));
const JAR = path.join(TREE, "forge-harness", "target", "forge-harness-jar-with-dependencies.jar");
const SEATS = ["White", "Blue", "Red"];
const PID = { White: "player-0", Blue: "player-1", Red: "player-2" };
const RAW = /engine-card-\d+|player-\d|prompt-action-\d+|stack-\d+/;

const lands = (name, n) => Array.from({ length: n }, () => name);
// the shapes: who casts what, what is made first (each list: names, made in that zone for that player), and how White
// answers (pick(ui, raw): option ids, or null for the first legal one)
const SHAPES = [
  { shape: "ChooseNumber (each player, secretly)", card: "Menacing Ogre", caster: "White",
    setup: { White: { battlefield: lands("Mountain", 5), hand: ["Menacing Ogre"] } } },
  { shape: "GenericChoice (an opponent chooses, each time)", card: "Remorseless Punishment", caster: "Blue", target: "White",
    setup: { Blue: { battlefield: lands("Swamp", 5), hand: ["Remorseless Punishment"] }, White: { battlefield: ["Grizzly Bears"], hand: ["Plains", "Plains", "Plains"] } } },
  { shape: "ChoosePlayer (an opponent)", card: "Black Vise", caster: "White",
    setup: { White: { battlefield: lands("Plains", 2), hand: ["Black Vise"] } } },
  { shape: "Fortify", card: "Darksteel Garrison", caster: "White", activate: "Fortify",
    setup: { White: { battlefield: [...lands("Plains", 5), "Darksteel Garrison"] } } },
  { shape: "Reconfigure", card: "Lizard Blades", caster: "White", activate: "Reconfigure",
    setup: { White: { battlefield: [...lands("Mountain", 4), "Lizard Blades", "Grizzly Bears"] } } },
  { shape: "Bestow", card: "Boon Satyr", caster: "White", cast: "Bestow",
    setup: { White: { battlefield: [...lands("Forest", 6), "Grizzly Bears"], hand: ["Boon Satyr"] } } },
  { shape: "ChooseColor (as it enters)", card: "Painter's Servant", caster: "White",
    setup: { White: { battlefield: lands("Island", 3), hand: ["Painter's Servant"] } } },
  { shape: "ChooseType (a creature type, as it enters)", card: "Cavern of Souls", caster: "White",
    setup: { White: { hand: ["Cavern of Souls"] } } },
  { shape: "ChooseCardName (as it enters)", card: "Pithing Needle", caster: "White",
    setup: { White: { battlefield: lands("Plains", 2), hand: ["Pithing Needle"] }, Blue: { battlefield: ["Llanowar Elves"] } } },
  { shape: "Vote (each player)", card: "Council's Judgment", caster: "White",
    setup: { White: { battlefield: lands("Plains", 3), hand: ["Council's Judgment"] }, Blue: { battlefield: ["Grizzly Bears"] }, Red: { battlefield: ["Hill Giant"] } } },
  { shape: "Charm on a trigger (choose one or more, each a different player)", card: "Vindictive Lich", caster: "White", sacrifice: "Vindictive Lich",
    setup: { White: { battlefield: [...lands("Swamp", 2), "Vindictive Lich"], hand: ["Village Rites"] }, Blue: { hand: ["Island", "Island"] }, Red: { hand: ["Mountain"] } } },
  { shape: "Tempting offer (each opponent may accept)", card: "Tempt with Discovery", caster: "White",
    setup: { White: { battlefield: lands("Forest", 4), hand: ["Tempt with Discovery"], library: ["Forest", "Island"] }, Blue: { library: ["Island"] }, Red: { library: ["Mountain"] } } },
];

function server() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "prompt-shapes-"));
  const c = spawnSync("javac", ["-nowarn", "-encoding", "UTF-8", "-proc:none", "-d", tmp, "-cp", JAR, path.join(ROOT, "engine", "checks", "HeadlessGameServer.java")], { encoding: "utf8" });
  if (c.status !== 0) throw new Error(`HeadlessGameServer doesn't compile: ${c.stderr}`);
  const p = spawn("java", ["-Xmx3g", "-cp", [tmp, JAR].join(path.delimiter), "forge.harness.host.HeadlessGameServer", "forge/forge-gui/"], { cwd: TREE, stdio: ["pipe", "pipe", "pipe"] });
  const lines = readline.createInterface({ input: p.stdout });
  const waiting = [];
  lines.on("line", (l) => { const w = waiting.shift(); if (w) w(JSON.parse(l)); });
  const stderr = [];
  p.stderr.on("data", (d) => { stderr.push(String(d)); if (stderr.length > 400) stderr.splice(0, 200); });
  const ask = (line) => new Promise((resolve) => { waiting.push(resolve); p.stdin.write(`${line}\n`); });
  const ready = new Promise((resolve) => waiting.push(resolve));
  return { ask, ready, stderr, quit: () => { try { p.stdin.write("quit\n"); } catch {} realTimeout(() => p.kill(), 2000); } };
}

// Blue's and Red's answers, and White's where no bridge is asked (setup): headless-six.js's, the first legal one
function scripted(prompt) {
  const input = prompt.input || {};
  const type = input.type;
  const r = (output) => ({ type, output });
  switch (type) {
    case "mulligan": return r({ type: "mulliganDecision", keep: true });
    case "chooseAction": return r({ type: "pass" });
    case "payManaCost": {
      // (a land at a time, as the table's own payment does: auto-pay asked again and again for Blue's {3}{B}{B})
      if (input.canConfirmFromPool) return r({ type: "pay", auto: false });
      const tap = (input.actions || []).find((x) => x.type === "activateManaAbility");
      return tap ? r({ type: "act", actionId: tap.id }) : r({ type: "pay", auto: true });
    }
    case "chooseBoardTargets": {
      const k = Math.min(input.maxTargets, Math.max(input.minTargets, 1), input.candidates.length);
      if (k === 0 && input.cancellable) return r({ type: "cancel" });
      return r({ type: "boardTargets", chosen: input.candidates.slice(0, k).map(({ kind, id }) => ({ kind, id })) });
    }
    case "chooseBoolean": return r({ type: "decision", value: false });
    case "chooseCards": return r({ type: "chooseCardsDecision", chosenCardIds: input.cards.slice(0, input.min).map((c) => c.id) });
    case "chooseNumber": return r({ type: "numberDecision", chosenNumber: input.min });
    case "chooseFromSelection": {
      const k = Math.min(Math.max(input.minTotal, 1), input.maxTotal, input.options.length);
      return r({ type: "selectionDecision", chosenIndices: [...Array(k).keys()] });
    }
    case "chooseColor": return r({ type: "colorDecision", chosenColors: { [input.validColors[0]]: input.amount } });
    case "reorder": return r({ type: "reorderDecision", orderedIds: input.items.map((i) => i.id) });
    case "revealCards": return r({ type: "revealCardsAcknowledged" });
    case "diceRolled": return r({ type: "diceRolledAcknowledged" });
    default: return null;
  }
}

// the bridge with White as its seat (tools/m6-stream.js's start, for three seats: White and two AI the bridge knows by
// name; the engine's Blue and Red are people answered here)
async function bridge() {
  const h = harness.load();
  const frame = (ws, m) => ws.emit("message", JSON.stringify(m));
  h.B.onTTS({ t: "start", json: JSON.stringify({ seats: ["White"], bots: 2, fromTable: true }) });
  await h.flush();
  const g = h.B._getGame();
  const white = g.seats.get("White");
  white.heartbeat = () => {};
  white.ws.emit("open");
  frame(white.ws, { type: "AuthResult", success: true });
  frame(white.ws, { type: "RoomList", rooms: [{ room_id: "room-1", room_name: "tts-commander", status: "Lobby" }] });
  const bots = ["self-hosted-node-77-bot", "self-hosted-node-77-bot 2"].map((u) => ({ username: u, ready: true, connected: true, is_bot: true }));
  frame(white.ws, { type: "RoomUpdate", room: { room_id: "room-1", status: "Lobby", max_players: 3, players: [{ username: white.username, ready: true, connected: true }, ...bots] } });
  await h.flush();
  const start = h.effects.map((e) => e.relay).find((r) => r?.type === "StartGame");
  const order = start ? start.seat_order : [white.username, "self-hosted-node-77-bot", "self-hosted-node-77-bot 2"];
  frame(white.ws, { type: "GameStarted", player_order: order, game_id: "g-shapes", starting_life: 20 });
  await h.flush();
  return { h, white, order };
}

const deck = (n) => Array.from({ length: 40 }, () => ({ name: n }));
// (the engine's player names are the relay's usernames, as in a real game: White's seat, then the two the bridge was
// told are its AI seats)
const request = (i, names) => ({ gameId: `prompt-shapes-${i}`, variant: "Constructed", startingLife: 20, seed: 3, snapshotRecording: true,
  players: [{ name: names[0], deck: deck("Plains"), commanderNames: [], ai: false, bot: false }, { name: names[1], deck: deck("Island"), commanderNames: [], ai: false, bot: false },
    { name: names[2], deck: deck("Mountain"), commanderNames: [], ai: false, bot: false }] });

async function probe(s, spec, i) {
  const out = { shape: spec.shape, card: spec.card, asked: [], problems: [], notes: [] };
  const { h, white, order } = await bridge();
  const started = await s.ask(`start ${JSON.stringify(request(i, order))}`);
  if (started.status !== "ok") { out.problems.push(`start: ${started.value.split("\n")[0]}`); harness.restore(); return out; }
  if (process.env.PROBE_TRACE) process.stderr.write(`bridge up: ${white.username}\n`);
  let last = "", n = 0, phase = "setup", fix = 0, idle = Date.now(), casterPid = PID[spec.caster];
  const view = async (seat = 0) => JSON.parse((await s.ask(`snapshot ${seat}`)).value || "{}");
  const cardId = (v, name, pid, zone) => (((v.zones || []).find((z) => z.zone === zone && z.ownerId === pid) || {}).cards || []).find((c) => c.identity?.name === name)?.id;
  try {
    for (let guard = 0; guard < 600; guard++) {
      const err = (await s.ask("error")).value;
      if (err) { out.problems.push(`engine error: ${err.split("\n").slice(0, 2).join(" | ")}`); break; }
      const pr = await s.ask("prompt");
      if (!pr.value || pr.value === last) {
        if (Date.now() - idle > 30000) { out.problems.push(`no new question for 30 s (${phase})`); break; }
        await sleep(25);
        continue;
      }
      last = pr.value; idle = Date.now();
      const prompt = JSON.parse(pr.value);
      const type = prompt.input?.type;
      const v = await view();
      if (process.env.PROBE_TRACE) process.stderr.write(`[${phase}] t${v.turn} ${v.step} active ${v.activePlayerId} ${prompt.decidingPlayerId} ${type}\n`);
      if (type === "gameOver") break;
      // (the setup: played to the caster's first main phase with an empty stack, then one apply_state)
      if (phase === "setup") {
        if (prompt.decidingPlayerId === casterPid && type === "chooseAction" && v.step === "main1" && v.activePlayerId === casterPid && !(v.stack || []).length) {
          const ops = [];
          for (const [who, zones] of Object.entries(spec.setup)) for (const [zone, names] of Object.entries(zones)) for (const name of names) ops.push({ op: "createCard", name, player: PID[who], zone });
          await s.ask(`submit ${JSON.stringify({ kind: "apply_state", fixId: ++fix, ops })}`);
          phase = "cast";
          continue;
        }
        const a = scripted(prompt);
        if (!a) { out.problems.push(`setup: unhandled ${type}`); break; }
        await s.ask(`submit ${JSON.stringify(a)}`);
        continue;
      }
      // (the cast, by whoever casts it: its action, by the card and the label)
      if (phase === "cast" && prompt.decidingPlayerId === casterPid && type === "chooseAction") {
        const want = spec.sacrifice ? "Village Rites" : spec.card;
        const zoneOf = spec.activate ? "battlefield" : (spec.setup[spec.caster].hand || []).includes(want) ? "hand" : "battlefield";
        const id = cardId(await view(Number(casterPid.slice(-1))), want, casterPid, zoneOf);
        const acts = (prompt.input.actions || []).filter((x) => x.cardId === id);
        const act = acts.find((x) => (spec.activate || spec.cast ? new RegExp(spec.activate || spec.cast, "i").test(x.label || "") : true)) || acts[0];
        if (!act) { out.problems.push(`no action for ${want}: ${JSON.stringify((prompt.input.actions || []).map((x) => x.label)).slice(0, 300)}`); break; }
        out.notes.push(`cast: ${act.label}`);
        phase = "resolve";
        // (White's cast goes through the bridge too: a priority question the table answers with the card's action)
        if (casterPid !== "player-0") { await s.ask(`submit ${JSON.stringify({ type, output: { type: "act", actionId: act.id } })}`); continue; }
        prompt.__pick = act.id;
      }
      if (phase === "resolve" && type === "chooseAction" && !(v.stack || []).length && !prompt.__pick) {
        n++;
        if (n > 1) break; // (the stack empty again after the cast: done)
      }
      if (prompt.decidingPlayerId !== "player-0") {
        if (process.env.PROBE_TRACE && type === "payManaCost") process.stderr.write(`  ${JSON.stringify(prompt.input).slice(0, 900)}\n`);
        const a = scripted(prompt);
        if (!a) { out.problems.push(`${prompt.decidingPlayerId}: unhandled ${type}`); break; }
        await s.ask(`submit ${JSON.stringify(a)}`);
        continue;
      }
      // White: through the bridge
      white.onEnvelope({ kind: "state", forPlayer: "player-0", state: { gameView: v }, fingerprint: `f${guard}` });
      await h.flush();
      const from = h.effects.length;
      white.onEnvelope({ kind: "prompt", forPlayer: "player-0", prompt });
      await h.flush();
      const responses = () => h.effects.slice(from).map((e) => e.relay).filter((r) => r?.type === "BroadcastState" && r.state?.kind === "response");
      const shown = h.effects.slice(from).filter((e) => e.tts?.t === "prompt" && e.tts.color === "White" && e.tts.promptId != null).map((e) => e.tts).at(-1);
      const rec = { type, engineTitle: prompt.input?.presentation?.title ?? null, source: prompt.sourceCard?.identity?.name ?? null };
      // (the engine's question and White's view, for tests/test_bridge_prompt_shapes.js: a library's cards left out)
      if (type !== "chooseAction" && type !== "payManaCost") {
        rec.raw = prompt;
        rec.view = { ...v, zones: (v.zones || []).map((z) => (z.zone === "library" ? { ...z, cards: [] } : z)) };
      }
      let answer = responses().at(-1)?.state?.action || null;
      const inp = prompt.input || {};
      rec.engine = { min: inp.min ?? inp.minTotal ?? inp.minTargets, max: inp.max ?? inp.maxTotal ?? inp.maxTargets,
        options: (inp.options || inp.cards || inp.candidates || inp.players || []).map((o) => o.label ?? o.name ?? o.identity?.name ?? o.id ?? o).slice(0, 12) };
      if (answer) rec.autoAnswered = true;
      else if (!shown) {
        rec.hang = true;
        answer = scripted(prompt);
      } else {
        rec.title = shown.title || null;
        rec.text = shown.text || null;
        rec.options = (shown.options || []).map((o) => o.label ?? o.id);
        rec.mode = shown.mode || null;
        const legal = (shown.options || []).filter((o) => !String(o.id).startsWith("__") || /^__(ok|yes|no|play|draw|keep)/.test(String(o.id)));
        const auto = (shown.options || []).find((o) => /^Auto-pay/.test(o.label || ""));
        const pick = prompt.__pick ? [prompt.__pick] : shown.mode === "number" ? [String(spec.number ?? 3)] : auto ? [auto.id] : (spec.pick ? spec.pick(shown, prompt) : null) || (shown.mode === "multi" ? legal.slice(0, Math.max(1, shown.min || 1)).map((o) => o.id) : legal.slice(0, 1).map((o) => o.id));
        rec.answered = pick.map((id) => (shown.options || []).find((o) => o.id === id)?.label ?? id);
        h.B.onTTS({ t: "answer", color: "White", promptId: shown.promptId, choice: pick });
        await h.flush();
        answer = responses().at(-1)?.state?.action || null;
        if (!answer) { rec.noAnswerSent = true; answer = scripted(prompt); }
      }
      rec.sent = answer;
      const flat = JSON.stringify([rec.title, rec.text, rec.options, rec.answered]);
      if (RAW.test(flat)) rec.rawId = flat.match(RAW)[0];
      out.asked.push(rec);
      if (!answer) { out.problems.push(`White: no answer for ${type}`); break; }
      const sub = await s.ask(`submit ${JSON.stringify(answer)}`);
      if (sub.status !== "ok") { rec.refused = sub.value.split("\n")[0]; out.problems.push(`refused: ${rec.refused}`); }
    }
    out.log = h.effects.filter((e) => e.tts?.t === "gamelog").flatMap((e) => e.tts.lines || []).slice(-14);
    out.chat = h.effects.filter((e) => e.tts?.t === "chat").map((e) => e.tts.text).slice(3).slice(-10);
    for (const l of [...out.log, ...out.chat]) if (RAW.test(l) || /\(\d{2,}\)/.test(l)) out.problems.push(`raw id in the log or chat: ${l.slice(0, 160)}`);
  } finally {
    harness.restore();
    await s.ask("end");
  }
  return out;
}

(async () => {
  const s = server();
  await s.ready;
  const results = [];
  for (const [i, spec] of SHAPES.entries()) {
    if (ONLY && !new RegExp(ONLY, "i").test(spec.shape)) continue;
    const r = await probe(s, spec, i);
    results.push(r);
    process.stdout.write(`== ${r.shape}: ${r.card} (${r.notes.join("; ")})\n`);
    for (const q of r.asked) process.stdout.write(`   ${q.type}${q.engineTitle ? ` "${q.engineTitle}"` : ""}: ${q.hang ? "HANG (nothing shown)" : q.autoAnswered ? `AUTO-ANSWERED (engine offered ${JSON.stringify(q.engine)}; sent ${JSON.stringify(q.sent?.output).slice(0, 120)})` : `"${q.title}" [${(q.options || []).join(" | ")}] -> ${JSON.stringify(q.answered)}`}${q.rawId ? ` RAW ID ${q.rawId}` : ""}${q.refused ? ` REFUSED ${q.refused}` : ""}${q.noAnswerSent ? " NO ANSWER SENT" : ""}\n`);
    for (const p of r.problems) process.stdout.write(`   problem: ${p}\n`);
    for (const l of r.log) process.stdout.write(`   log: ${l}\n`);
    for (const l of r.chat) process.stdout.write(`   chat: ${l}\n`);
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  s.quit();
  realTimeout(() => process.exit(0), 2500);
})().catch((e) => { process.stdout.write(`probe crashed: ${e.stack}\n`); process.exit(1); });
