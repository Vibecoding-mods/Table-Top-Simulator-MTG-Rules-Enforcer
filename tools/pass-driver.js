// A quiet stand-in for a player who only passes, for performance tests in the real TTS: it reads the open question
// from the bridge (/state) and answers it through the bridge's /msg, the way the table itself does. It never runs
// Lua in TTS (each such call costs TTS ~360 ms, which made the test tools look like stutter).
//   node tools/pass-driver.js <color> [stopGameTurn=100] [bridgePort=48787]
const COLOR = process.argv[2] || "Blue";
const STOP = Number(process.argv[3] || 100);
const PORT = Number(process.argv[4] || 48787);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = () => fetch(`http://127.0.0.1:${PORT}/state`).then((r) => r.json());
const answer = (promptId, choice) => fetch(`http://127.0.0.1:${PORT}/msg`, { method: "POST",
  body: JSON.stringify({ t: "answer", json: JSON.stringify({ t: "answer", color: COLOR, promptId, choice }) }) });

(async () => {
  let lastId = null, answered = 0;
  for (;;) {
    const st = await get().catch(() => null);
    const seat = st && (st.seats || []).find((s) => s.color === COLOR);
    if (!st || !st.started || !seat) { await sleep(1000); if (answered) break; continue; }
    if ((seat.turn || 0) > STOP) break;
    const p = seat.rawPrompt;
    if (p && p.promptId !== lastId) {
      const input = p.input || {};
      let choice = null;
      if (input.type === "chooseAction") choice = ["__endturn"];
      else if (input.type === "mulligan") choice = ["keep"];
      else if (input.type === "diceRolled" || input.type === "revealCards") choice = ["ok"];
      else if (input.type === "chooseAttackers" || input.type === "chooseBlockers") choice = [];
      else if (input.type === "chooseCards") choice = (input.cards || []).slice(0, input.min || 0).map((c) => c.id); // discard to 7
      else if (input.type === "chooseBoolean") choice = ["no"];
      if (choice) { lastId = p.promptId; answered++; await answer(p.promptId, choice); }
    }
    await sleep(300);
  }
  console.log(JSON.stringify({ answered }));
})();
