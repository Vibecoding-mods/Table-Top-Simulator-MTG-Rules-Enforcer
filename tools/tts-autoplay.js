// Plays White's prompts in the open TTS game by pressing the engine panel's buttons (via the bridge debug channel).
// Strategy: keep hand, play a land when possible, cast the first castable spell, auto-pay, first legal picks.
//   node tts-autoplay.js [maxSteps] [stopAtTurn]
const MAX = Number(process.argv[2] || 150), STOP_TURN = Number(process.argv[3] || 6);
const exec = async (lua) => {
  const r = await fetch("http://127.0.0.1:48787/exec", { method: "POST", body: lua }).then((x) => x.json());
  if (r.console?.some((l) => l.includes("ERROR"))) console.log("TTS ERROR:", r.console.filter((l) => l.includes("ERROR")).join("\n"));
  return r.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getState = `local p = enginePrompts and enginePrompts.White
local m = { turn = lastTableTurn, prompt = nil }
if p then m.prompt = { id = p.promptId, title = p.title, mode = p.mode, min = p.min, max = p.max, options = {} }
  for i, o in ipairs(p.options or {}) do m.prompt.options[i] = o.label end end
return JSON.encode(m)`;
(async () => {
  await exec(`local old = engineRender function engineRender(m) lastTableTurn = m.turn return old(m) end return "hooked"`);
  let castTries = 0, lastId = null, idle = 0;
  for (let step = 0; step < MAX; step++) {
    const s = JSON.parse(await exec(getState) || "{}");
    if (s.turn > STOP_TURN) { console.log(`reached turn ${s.turn}, stopping`); break; }
    const p = s.prompt;
    if (!p || p.id === lastId) { if (++idle > 40) { console.log("no prompt for a while; stopping"); break; } await sleep(250); continue; }
    idle = 0; lastId = p.id; if (!p.title.startsWith("Pay")) global.lastPay = null;
    const opts = p.options;
    let click;
    if (p.mode === "single") {
      let i = 0;
      if (p.title.startsWith("Mulligan")) i = 0;
      else if (p.title === "Your priority") {
        const land = opts.findIndex((l) => /^play /i.test(l));
        const cast = opts.findIndex((l) => /^cast /i.test(l));
        i = land >= 0 ? land : (cast >= 0 && castTries < 2 ? (castTries++, cast) : 0);
        if (i === 0) castTries = 0;
      } else if (p.title.startsWith("Pay")) { if (p.title === global.lastPay) { console.log("payment prompt repeated: " + p.title); process.exit(2); } global.lastPay = p.title; i = 0; }
      click = `onMtgClick(Player.White, nil, "o|White|${i + 1}")`;
      console.log(`turn ${s.turn}: ${p.title} -> ${opts[i]}`);
    } else if (p.mode === "multi") {
      const k = Math.max(p.min || 0, 0);
      click = Array.from({ length: k }, (_, j) => `onMtgClick(Player.White, nil, "o|White|${j + 1}")`).join(" ") + ` onMtgClick(Player.White, nil, "confirm|White")`;
      console.log(`turn ${s.turn}: ${p.title} -> pick ${k}`);
    } else if (p.mode === "number") {
      click = `onMtgClick(Player.White, nil, "n|White|${p.min}")`;
    } else { console.log("unknown mode", p.mode); break; }
    await exec(click + ` return "ok"`);
    await sleep(150);
  }
})();
