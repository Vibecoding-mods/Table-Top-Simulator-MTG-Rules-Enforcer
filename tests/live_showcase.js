// Showcase game for a screen recording: every table effect and every table sound once, in order, with a pause after
// each (scenarios/showcase.json). White is the human seat and is played by this script; one Forge AI (the passive
// lands deck) only sits there at 11 life with four creatures. Each beat prints "[mm:ss.s] <what> -> <effects>" for
// labelling the recording.
//   node tests/live_showcase.js [--port 48787] [--stream tmp/tts-stream.jsonl] [--pause 3] [--no-start] [--fxlog] [--dry] [--verbose]
// --port     the bridge's debug HTTP port (48787 is the live bridge; the headless TTS's test bridge uses another)
// --stream   the bridge's MTG_RECORD file (tools/start-bridge.ps1 sets tmp/tts-stream.jsonl): the panel questions the
//            table is shown are read from it, so the script never runs Lua in TTS (each such call freezes TTS ~360 ms)
// --no-start the game is started by hand (type "mtg debug showcase", then Start); the script waits for it
// --fxlog    after each beat, read the table's last effects and sounds (engineFxLast, engineSoundLog) with one Lua call:
//            for the headless TTS; in the real TTS it costs a 360 ms freeze per beat, so it is off unless asked
// --dry      print the plan and check the bridge answers; sends nothing
// --pause    seconds after each beat (default 3)
// Headless check (2026-11-14, all 16 beats, every sound kind picked): headless TTS + a second bridge on spare ports
// against a test stack, as tools/headless-coverage.sh does, then --port <its debug port> --stream <its MTG_RECORD> --fxlog.
// Safety: it answers only White's questions and sends only White's messages (deck, AI deck, debug, hold, start,
// answers); it never resets the table or the Forge room, never restarts a container, and refuses to start when a game
// is already running (with --no-start it plays the game that is running, which must be the showcase one).
const fs = require("fs"), path = require("path");

const arg = (n, d) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (n) => process.argv.includes(`--${n}`);
const PORT = Number(arg("port", 48787));
const STREAM = path.resolve(arg("stream", path.join(__dirname, "..", "tmp", "tts-stream.jsonl")));
const PAUSE = Number(arg("pause", 3)) * 1000;
const DRY = flag("dry"), VERBOSE = flag("verbose"), FXLOG = flag("fxlog"), NOSTART = flag("no-start");
const C = "White";
const URL = `http://127.0.0.1:${PORT}`;
const T0 = Date.now();
const stamp = () => { const s = (Date.now() - T0) / 1000; return `${String(Math.floor(s / 60)).padStart(2, "0")}:${(s % 60).toFixed(1).padStart(4, "0")}`; };
const say = (s) => process.stdout.write(`[${stamp()}] ${s}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The beats. act: the priority option to take (its label); targets: one per question that follows, matched on the
// option labels (the bridge's labels, read live 2026-11-14); colour: a mana colour question's pick; x: a number question's value; hold: keep priority after it
// goes on the stack (for the Counterspell beat, whose `then` is cast over it). fx: what the table should show / play.
const OPP = /^AI 1\b|player-1|opponent/i;
const BEATS = [
  { label: "Prodigal Pyromancer pings Hill Giant", act: /^Prodigal Pyromancer:/, targets: [/Hill Giant/], fx: "bolt + damage | sound: damage" },
  { label: "Prodigal Sorcerer pings the opponent", act: /^Prodigal Sorcerer:/, targets: [OPP], fx: "bolt + player_hit | sound: playerhit" },
  { label: "Gavony Township: +1/+1 counters", act: /^Gavony Township: \{2\}/, fx: "counter | sound: counter" },
  { label: "The Scorpion God: -1/-1 counter on Hill Giant", act: /^The Scorpion God:/, targets: [/Hill Giant/], fx: "counter_minus | sound: counter" },
  { label: "Lightning Bolt -> Grizzly Bears", act: /^Cast Lightning Bolt/, targets: [/Grizzly Bears/], fx: "bolt + death_burn | sound: death" },
  { label: "Doom Blade -> Craw Wurm", act: /^Cast Doom Blade/, targets: [/Craw Wurm/], fx: "death | sound: death" },
  { label: "Declaration in Stone -> Serra Angel", act: /^Cast Declaration in Stone/, targets: [/Serra Angel/], fx: "exile | sound: exile" },
  { label: "Shock -> opponent, countered by Counterspell", act: /^Cast Shock/, targets: [OPP], hold: true,
    then: { act: /^Cast Counterspell/, targets: [/Shock/] }, fx: "countered | sound: countered" },
  { label: "Angel's Mercy: White gains 7", act: /^Cast Angel's Mercy/, fx: "lifegain | sound: lifegain" },
  { label: "Think Twice (draw a card)", act: /^Cast Think Twice/, fx: "(instant resolves) | sound: instant" },
  { label: "Strike It Rich: a Treasure", act: /^Cast Strike It Rich/, fx: "(Treasure token) | sound: treasure" },
  { label: "Treasure sacrificed for blue mana", act: /^Mana: tap Treasure/, colour: /blue|\{U\}/i, fx: "(Treasure leaves) | sound: treasurespend" },
  { label: "Divination (paid with the Treasure's mana)", act: /^Cast Divination/, fx: "(sorcery resolves) | sound: sorcery" },
  { label: "Wrath of God (4 creatures)", act: /^Cast Wrath of God/, fx: "board wipe wave (white) | sound: wipe" },
  { label: "Banefire X=7 -> opponent", act: /^Cast Banefire/, x: 7, targets: [OPP], fx: "bolt + bighit | sound: bighit" },
  { label: "Lightning Bolt -> opponent (lethal)", act: /^Cast Lightning Bolt/, targets: [OPP], fx: "bolt + player_hit + knockout | sound: knockout" },
];

const get = (p) => fetch(`${URL}${p}`, { signal: AbortSignal.timeout(15000) }).then((r) => (p === "/log" ? r.text() : r.json()));
const send = (t, body) => (DRY ? Promise.resolve() : fetch(`${URL}/msg`, { method: "POST", body: JSON.stringify({ t, json: JSON.stringify({ t, ...body }) }) }));
const exec = (lua) => fetch(`${URL}/exec`, { method: "POST", body: lua, signal: AbortSignal.timeout(60000) }).then((r) => r.json());

// the newest panel question for White, from the recording (null: none open)
let streamPos = 0, prompt = null, promptAt = 0;
function readStream() {
  let size;
  try { size = fs.statSync(STREAM).size; } catch { return; }
  if (size < streamPos) streamPos = 0;
  if (size === streamPos) return;
  const fd = fs.openSync(STREAM, "r"), buf = Buffer.alloc(size - streamPos);
  fs.readSync(fd, buf, 0, buf.length, streamPos); fs.closeSync(fd);
  const text = buf.toString("utf8"), end = text.lastIndexOf("\n");
  if (end < 0) return;
  streamPos += Buffer.byteLength(text.slice(0, end + 1));
  for (const line of text.slice(0, end).split("\n")) {
    let m; try { m = JSON.parse(line).msg; } catch { continue; }
    if (m.t !== "prompt") continue;
    const p = JSON.parse(m.json);
    if (p.color !== C) continue;
    prompt = p.promptId == null ? null : p;
    promptAt = Date.now();
  }
}
const seatState = async () => { const s = await get("/state"); return { started: s.started, seat: (s.seats || []).find((x) => x.color === C) }; };
const key = (p) => p && `${p.promptId}/${p.step ?? ""}/${p.title}`;
let answered = null;
// the next open question we have not answered yet (waits up to ms)
async function nextPrompt(ms = 20000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    readStream();
    if (prompt && key(prompt) !== answered) return prompt;
    await sleep(150);
  }
  return null;
}
async function answer(p, choice) {
  answered = key(p);
  if (VERBOSE) say(`  answer "${p.title}" -> ${JSON.stringify(choice)}`);
  await send("answer", { color: C, promptId: p.promptId, choice });
}
const show = (p) => `"${p.title}" (${p.mode}${p.min != null ? ` ${p.min}-${p.max}` : ""}): ${(p.options || []).map((o) => `${o.id}=${o.label}`).join(" | ").slice(0, 900)}`;
const isPriority = (p) => (p.options || []).some((o) => o.id === "__pass");
const stackBusy = (p) => (p.options || []).some((o) => o.id === "__pass" && o.label === "Resolve");

// one question that is not a priority: targets, payment, mana colour, X, yes/no
async function answerOther(p, want) {
  const opts = p.options || [];
  const byLabel = (re) => opts.find((o) => re && re.test(o.label) && !String(o.id).startsWith("__"));
  if (want.colour && byLabel(want.colour)) return answer(p, [byLabel(want.colour).id]);
  if (/pay|mana/i.test(p.title) || opts.some((o) => o.id === "__auto" || o.id === "__pool")) {
    const o = opts.find((x) => x.id === "__pool") || opts.find((x) => x.id === "__auto");
    if (o) return answer(p, [o.id]);
  }
  if (p.mode === "number" || /\bX\b|number|how many/i.test(p.title)) {
    const o = opts.find((x) => String(x.id) === String(want.x) || x.label === String(want.x));
    return answer(p, [o ? o.id : String(want.x ?? p.min ?? 0)]);
  }
  const re = want.targets?.[want.ti ?? 0];
  const hit = byLabel(re);
  if (hit) { want.ti = (want.ti ?? 0) + 1; return answer(p, [hit.id]); }
  const yes = opts.find((o) => /^(yes|ok|done|keep|confirm)/i.test(o.label));
  if (yes) return answer(p, [yes.id]);
  throw new Error(`no answer for ${show(p)}`);
}

// a beat: take its action, answer what follows, cast its `then` over it, resolve the stack
async function play(beat) {
  const want = { ...beat, ti: 0 };
  let cur = want, acted = false, chained = !beat.then, armed = false;
  for (let guard = 0; guard < 60; guard++) {
    let p = null;
    for (let tries = 0; !p && tries < 10; tries++) {
      p = await nextPrompt(2000);
      // (the lethal beat: the game is over, no question follows)
      if (!p && acted && (await get("/health").catch(() => ({}))).phase === "over") return null;
    }
    if (!p) throw new Error(`${beat.label}: no question came (last: ${prompt ? show(prompt) : "none"})`);
    if (VERBOSE) say(`  ${show(p)}`);
    if (!isPriority(p)) { await answerOther(p, cur); continue; }
    if (!acted) {
      const o = p.options.find((x) => beat.act.test(x.label));
      if (!o) throw new Error(`${beat.label}: no option ${beat.act} in ${show(p)}`);
      if (beat.hold && !armed) { armed = true; await send("hold", { color: C }); await sleep(300); }
      acted = true;
      await answer(p, [o.id]);
      continue;
    }
    if (!chained && stackBusy(p)) {
      const o = p.options.find((x) => beat.then.act.test(x.label));
      if (!o) throw new Error(`${beat.label}: no option ${beat.then.act} over the stack in ${show(p)}`);
      chained = true;
      cur = { ...beat.then, ti: 0 };
      await answer(p, [o.id]);
      continue;
    }
    if (stackBusy(p)) { await answer(p, ["__pass"]); continue; }
    return p; // back at an empty stack: the beat is done (this question is the next beat's)
  }
  throw new Error(`${beat.label}: too many questions`);
}

// --fxlog: the sound each board picked (engineSoundPlay is wrapped once, so a sound the table can't play here, with no
// music player or sound bundle, is still seen) and the effects the table started (engineFxLast: the slot looks; the
// effect bundle's rig-only kinds and the bolts need the bundles, in the real TTS)
const HOOK = `if not __showcaseHook then __showcaseHook = true __showcaseSnd = {}
  local old = engineSoundPlay
  engineSoundPlay = function(kind, force, n) __showcaseSnd[#__showcaseSnd + 1] = tostring(kind) return old(kind, force, n) end end
  return "hooked"`;
let sndSeen = 0;
async function fxNote() {
  if (!FXLOG) return "";
  const r = await exec(`local f = engineFxLast or {} local kinds = {} for _, e in ipairs(f.fx or {}) do kinds[#kinds + 1] = tostring(e.kind) .. (e.rig and "(rig)" or "") end
    return JSON.encode({ fx = kinds, dropped = f.dropped or 0, snd = __showcaseSnd or {} })`).catch((e) => ({ value: null, error: e.message }));
  let v; try { v = JSON.parse(r.value); } catch { return ` [fxlog unreadable: ${JSON.stringify(r).slice(0, 200)}]`; }
  const snd = (v.snd || []).slice(sndSeen); sndSeen = (v.snd || []).length;
  return ` [table fx: ${(v.fx || []).join(", ") || "-"}${v.dropped ? ` (+${v.dropped} without a look here)` : ""}; sounds picked: ${snd.join(", ") || "-"}]`;
}

(async () => {
  say(`showcase on ${URL}${DRY ? " (dry run)" : ""}; panel questions from ${STREAM}`);
  const health = await get("/health").catch((e) => ({ error: e.message }));
  if (health.error) { say(`STOP: no bridge on ${URL} (${health.error})`); process.exit(1); }
  say(`bridge ${health.bridge}, phase ${health.phase}, TTS connected ${health.ttsConnected}`);
  if (!fs.existsSync(STREAM)) say(`WARNING: ${STREAM} does not exist: start the bridge with MTG_RECORD (tools/start-bridge.ps1 does)`);
  if (DRY) {
    BEATS.forEach((b, i) => say(`beat ${i + 1}: ${b.label} -> ${b.fx}`));
    say("dry run: nothing sent"); process.exit(0);
  }
  if (!NOSTART) {
    // (only from a bridge with no game at all: a start over an old game can restart the Forge room, which this script
    // never does; the host types "mtg reset" or restarts the bridge first, or uses --no-start)
    if (health.phase !== "none") { say(`STOP: the bridge has a game (${health.phase}); type "mtg reset" in TTS or restart the bridge first, or start it yourself and pass --no-start`); process.exit(1); }
    // a preset deck for White (Sisay, five colours: every land's mana counts in Commander; plain creatures, no miracle
    // or other free plays that would ask on a draw), the AI's passive deck,
    // the scenario, then the start the table's own Start sends (fromTable: the debug setup needs it)
    await send("deck", { color: C, deck: "ai_gap_creatures" });
    await send("aideck", { deck: "ai_passive_lands" });
    await send("debug", { color: C, scenario: "showcase" });
    await sleep(500);
    readStream(); prompt = null; // (only questions from now on)
    await send("start", { seats: [C], bots: 1, requireReady: false, fromTable: true });
    say("game starting: White + 1 Forge AI");
  } else readStream();
  // up to White's first main phase with the scenario on the board: pass everything else
  const t = Date.now();
  for (;;) {
    if (Date.now() - t > 240000) { say("STOP: White never reached a main phase with the showcase board"); process.exit(1); }
    const p = await nextPrompt(5000);
    if (!p) continue;
    const { seat } = await seatState();
    const mine = seat?.battlefield?.find((b) => b.owner === seat.slot)?.cards || [];
    // (a sorcery castable with the scenario's creatures out: White's own main phase, empty stack)
    if (mine.includes("Prodigal Pyromancer") && isPriority(p) && !stackBusy(p) && p.options.some((o) => /^Cast Wrath of God/.test(o.label))) break;
    if (isPriority(p)) await answer(p, ["__pass"]);
    else if (p.options?.some((o) => o.id === "keep")) await answer(p, ["keep"]);
    else if (p.options?.some((o) => o.id === "ok")) await answer(p, ["ok"]);
    else {
      // (anything else before the board is set: decline it, so nothing changes the scripted life totals)
      const no = p.options?.find((o) => /^(no|__no|__cancel|__skip|__back)$/.test(o.id) || /^(no\b|don't|decline|skip|cancel)/i.test(o.label));
      if (VERBOSE) say(`  before the showcase: ${show(p)}`);
      await answer(p, [(no || p.options?.[0])?.id]);
    }
  }
  if (FXLOG) await exec(HOOK);
  say("showcase board ready, White's main phase");
  await sleep(PAUSE);
  let failed = 0;
  for (const [i, beat] of BEATS.entries()) {
    const at = stamp();
    try {
      const next = await play(beat);
      if (next) { prompt = next; answered = null; }
    } catch (e) {
      failed++;
      say(`beat ${i + 1} FAILED: ${e.message}`);
      break;
    }
    await sleep(600);
    process.stdout.write(`[${at}] ${beat.label} -> ${beat.fx}${await fxNote()}\n`);
    await sleep(Math.max(0, PAUSE - 600));
  }
  const log = await get("/log").catch(() => "");
  const over = /GAME OVER|wins the game|won the game/i.test(String(log).split("\n").slice(-30).join("\n"));
  say(failed ? "showcase stopped early" : `showcase done${over ? " (game over)" : ""}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { say(`STOP: ${e.stack || e.message}`); process.exit(1); });
