// Hand-play sweep: plays White the way a person plays on the table, with gestures instead of the menu wherever the
// table offers one, and checks after every gesture that the engine got what the gesture meant:
//   land or spell dragged onto the battlefield -> it is played / cast (or the engine asks how to pay / what to target)
//   a land turned with Q/E -> it is tapped for mana; a card with a {T} ability turned -> the ability is used
//   a land turned while paying -> it pays
//   attack: click a creature, then the defending player's life counter, then Done -> it attacks that player
//   block: click your creature, then the attacker -> that block is picked
//   a target, or a card to choose: click the card / life counter -> it is picked
//   a discard: drag the card to the graveyard -> it is discarded
// Everything else (modes, numbers, order, yes/no) goes through the panel, as a player would. Also runs
// tools/tts-check.lua (table vs engine) every few steps, like tools/tts-autoplay2.js, and reports in the same shape
// plus `gestures` (tried / ok per kind) and `failed` (each gesture the engine didn't get, with what the table said).
//   node tools/handplay.js [stopAtGameTurn] [maxSteps]     (BRIDGE_PORT=48788 for the headless TTS)
const fs = require("fs"), path = require("path");
const C = process.env.AP_COLOR || "White";
const BRIDGE_PORT = process.env.BRIDGE_PORT || 48787;
const STOP = Number(process.argv[2] || 14), MAX = Number(process.argv[3] || 600);
const tools = __dirname;
const report = { recent: [], steps: 0, drags: 0, refused: 0, errors: [], problems: [], stuck: [], prompts: {}, lastTurn: 0,
  gestures: {}, failed: [], castByDrag: [], panel: {}, questions: [] };
// (the bridge may be restarting, e.g. after a crash: wait for it rather than stop, up to 90 s)
async function retrying(fn) {
  const t0 = Date.now();
  for (;;) {
    try { return await fn(); } catch (e) {
      if (Date.now() - t0 > 90000) throw e;
      report.bridgeDown = (report.bridgeDown || 0) + 1;
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
const exec = async (lua) => {
  const r = await retrying(() => fetch(`http://127.0.0.1:${BRIDGE_PORT}/exec`, { method: "POST", body: lua, signal: AbortSignal.timeout(60000) }).then((x) => x.json()));
  for (const l of r.console || []) if (l.includes("ERROR")) report.errors.push(l.slice(0, 300));
  return r.value;
};
const state = () => retrying(() => fetch(`http://127.0.0.1:${BRIDGE_PORT}/state`).then((x) => x.json()));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const q = (s) => JSON.stringify(String(s)); // a Lua string literal (JSON escapes are valid Lua escapes here)
const want = (process.env.KW_CARDS || "").split("|").filter(Boolean);
const isWanted = (label) => want.some((w) => String(label || "").includes(w));

let lastProblems = new Map(), reported = new Set();
async function check(tag) {
  const released = await exec(`return tostring(engineReleasePending ~= nil and engineReleasePending("${C}", "all"))`);
  if (released === "true") await sleep(1200);
  const v = await exec(fs.readFileSync(path.join(tools, "tts-check.lua"), "utf8"));
  if (!v) return;
  const r = JSON.parse(v);
  const key = (p) => p.replace(/\s*\[obj=.*$/, "").replace(/ at \([^)]*\)/, "");
  const now = new Map((r.problems || []).map((p) => [key(p), p]));
  for (const [k, p] of now) if (lastProblems.has(k) && !reported.has(k)) { reported.add(k); report.problems.push(`turn ${r.turn} ${r.step} [${tag}]: ${p}`); }
  for (const k of lastProblems.keys()) if (!now.has(k) && !reported.has(k)) report.transient = (report.transient || 0) + 1;
  lastProblems = now;
  return r;
}

const prompt = async () => JSON.parse((await exec(`return HP.prompt("${C}")`)) || "null");
const where = (id) => exec(`return HP.where(${q(id)})`);
const said = async () => Number(await exec("return tostring(HP.n)")) || 0;

// one gesture: do it, then wait up to `ms` for `ok()` (polled); records the outcome under `kind`
async function gesture(kind, what, doIt, ok, ms = 4000) {
  const g = (report.gestures[kind] ||= { tried: 0, ok: 0 });
  g.tried++;
  const before = await said();
  const st0 = await state().catch(() => null);
  const pid0 = st0?.seats?.find((s) => s.color === C)?.rawPrompt?.promptId;
  const did = await doIt();
  const t0 = Date.now();
  let last = "";
  while (Date.now() - t0 < ms) {
    await sleep(350);
    last = await ok(pid0);
    if (last === true) { g.ok++; return true; }
  }
  const told = await exec(`return HP.saidSince(${before})`);
  // the engine refusing is a fair answer (no mana, no legal target) when the table said why; still listed
  const refused = /can't|cannot|not now|isn't|no legal|can not|wrong colour/i.test(told || "");
  if (refused) g.refused = (g.refused || 0) + 1;
  report.failed.push({ kind, what, turn: report.lastTurn, did, state: String(last).slice(0, 160), told: (told || "").slice(0, 300), refused });
  return false;
}
const promptMoved = async (pid0) => {
  const st = await state().catch(() => null);
  return st?.seats?.find((s) => s.color === C)?.rawPrompt?.promptId !== pid0;
};

async function drag(cardId, area) {
  const where = area === "graveyard" ? `local g = data.${C}.graveyard.getPosition() local pos = Vector(g.x, 1.5, g.z)`
    : area === "library" ? `local g = getDeckFromZone(data.${C}.libraryZone) local z = g and g.getPosition() or data.${C}.libraryZone.getPosition() local pos = Vector(z.x, 2, z.z)`
    : C === "White" ? `local pos = Vector(${rnd(6, 33).toFixed(1)}, 1.5, ${rnd(-21, -8).toFixed(1)})`
    : `local h = Player["${C}"].getHandTransform().position local d = Vector(-h.x, 0, -h.z):normalized() local pos = h + d * ${rnd(11, 17).toFixed(1)} + Vector(0, 1.5, 0)`;
  report.drags++;
  return exec(`${where} local o = HP.obj(${q(cardId)}) if o == nil then return "missing" end simDrop("${C}", o, pos) return "dropped"`);
}
const click = (id) => exec(`return HP.click("${C}", ${q(id)})`);
const turn = (id) => exec(`return HP.turn("${C}", ${q(id)})`);
const panel = (i) => exec(`onMtgClick(Player.${C}, nil, "o|${C}|${i}") return "ok"`);
const done = () => exec(`engineCornerPress("${C}", "big") return "ok"`);
const selected = async (pred) => { const p = await prompt(); return !!p && p.options.some((o) => o.sel && pred(o)); };
const noteName = (label) => String(label || "").replace(/^(Cast|Play) /i, "").replace(/ —.*$/, "");

const turnedThisTurn = new Set(), tries = {};
(async () => {
  await exec(fs.readFileSync(path.join(tools, "tts-sim.lua"), "utf8"));
  await exec(fs.readFileSync(path.join(tools, "handplay.lua"), "utf8"));
  await exec(`local old = engineRender function engineRender(m) debugTable = m lastTableTurn = m.turn return old(m) end return "hooked"`);
  let lastPid = null, samePid = 0, idle = 0, turnSeen = 0;
  let payRepeat = 0, lastPayTitle = null, payTitle = null, payCount = 0;
  for (let step = 0; step < MAX; step++) {
    const st = await state();
    const w = (st.seats || []).find((s) => s.color === C);
    if (!st.started || !w) { console.log("game not running"); break; }
    report.lastTurn = w.turn;
    if (w.turn !== turnSeen) { turnSeen = w.turn; turnedThisTurn.clear(); }
    if (w.turn > STOP) break;
    const p = await prompt();
    if (!p) {
      if (JSON.parse((await exec(`return JSON.encode({ over = debugTable and debugTable.gameOver or false })`)) || "{}").over) { console.log("game over"); break; }
      if (++idle % 20 === 0) await check("idle");
      if (idle > 120) { report.stuck.push(`no prompt for 60s at turn ${w.turn} ${w.step}`); break; }
      await sleep(500); continue;
    }
    idle = 0;
    if (p.id === lastPid) { if (++samePid === 8) report.stuck.push(`prompt "${p.title}" repeated 8 times (turn ${w.turn} ${w.step})`); } else samePid = 0;
    if (p.id !== lastPid) {
      // what the player saw (one entry per question; tools/question-review.js groups them)
      await sleep(300);
      const seen = JSON.parse((await exec(`return HP.seen("${C}")`)) || "{}");
      report.questions.push({ turn: w.turn, type: w.rawPrompt?.input?.type, src: w.rawPrompt?.sourceCard?.identity?.name, title: p.title, kind: p.kind, mode: p.mode, n: p.options.length, opts: p.options.slice(0, 6).map((o) => o.label), ...seen });
    }
    lastPid = p.id;
    report.steps++;
    const raw = w.rawPrompt?.input || {};
    report.recent.push(`${w.turn}:${raw.type || p.title}`); if (report.recent.length > 8) report.recent.shift();
    report.prompts[raw.type || p.title] = (report.prompts[raw.type || p.title] || 0) + 1;
    const stuck = samePid >= 3;

    if (p.kind === "action" && !stuck) {
      // a drawn card waits on top of the library until the player takes it (click the library / Draw): take it first
      if ((await exec(`return tostring(engineReleasePending ~= nil and engineReleasePending("${C}", "all"))`)) === "true") { await sleep(1200); continue; }
      const acts = raw.actions || [];
      const mine = (await exec(`return HP.mine("${C}")`) || "").split(";").filter(Boolean).map((s) => { const [id, n, t] = s.split("="); return { id, n, tapped: t === "true" }; });
      const onBf = new Set(mine.map((c) => c.id));
      const isLand = (a) => a.type === "playLand" || (a.type === "cast" && /^play /i.test(a.label || ""));
      const land = acts.find(isLand);
      const spells = acts.filter((a) => a.type === "cast" && !isLand(a));
      const spell = spells.find((a) => isWanted(a.label)) || spells[0];
      const tapAb = acts.find((a) => !a.isManaAbility && a.type !== "cast" && a.type !== "undoMana" && onBf.has(String(a.cardId))
        && /\{T\}/.test(`${a.cost || ""} ${a.label || ""} ${a.description || ""}`) && !turnedThisTurn.has(String(a.cardId)));
      const manaSrc = acts.find((a) => a.isManaAbility && onBf.has(String(a.cardId)) && !mine.find((c) => c.id === String(a.cardId))?.tapped && !turnedThisTurn.has(String(a.cardId)));
      if (land) {
        await gesture("play land (drag)", noteName(land.label), () => drag(land.cardId, "battlefield"),
          async () => /:battlefield/.test(await where(land.cardId)) || `still ${await where(land.cardId)}`);
        continue;
      }
      if (tapAb && Math.random() < 0.6) {
        turnedThisTurn.add(String(tapAb.cardId));
        const name = mine.find((c) => c.id === String(tapAb.cardId))?.n;
        await gesture("{T} ability (Q/E)", `${name}: ${tapAb.description || tapAb.label}`, () => turn(tapAb.cardId),
          async (pid0) => (await where(tapAb.cardId)) === "stack" || /tapped|graveyard|exile/.test(await where(tapAb.cardId)) || (await promptMoved(pid0)) || `still ${await where(tapAb.cardId)}`);
        continue;
      }
      if (spell && manaSrc && Math.random() < 0.5) {
        turnedThisTurn.add(String(manaSrc.cardId));
        const name = mine.find((c) => c.id === String(manaSrc.cardId))?.n;
        // a land that makes more than one colour asks which (the panel answers that next)
        await gesture("tap for mana (Q/E)", name, () => turn(manaSrc.cardId),
          async () => /:tapped/.test(await where(manaSrc.cardId)) || /which mana/i.test((await prompt())?.title || "") || `still ${await where(manaSrc.cardId)}`);
        continue;
      }
      const tryKey = `${w.turn}:${spell && spell.cardId}`;
      if (spell && (tries[tryKey] || 0) < 2 && (isWanted(spell.label) || Math.random() < 0.75)) {
        tries[tryKey] = (tries[tryKey] || 0) + 1;
        const ok = await gesture("cast (drag)", noteName(spell.label), () => drag(spell.cardId, "battlefield"),
          async (pid0) => { const at = await where(spell.cardId); return !/:hand|:command/.test(at) || (await promptMoved(pid0)) || ((await prompt())?.title || "") !== p.title || `still ${at}`; });
        if (ok) report.castByDrag.push(noteName(spell.label));
        continue;
      }
      // other abilities (cycling, equip, ninjutsu...) have no gesture: the panel, sometimes, so keywords get used
      const other = acts.find((a) => a.type !== "cast" && !a.isManaAbility && a.type !== "undoMana" && !turnedThisTurn.has(`panel:${a.id}`));
      if (other && Math.random() < 0.3) {
        const i = p.options.findIndex((o) => o.id === String(other.id));
        if (i >= 0) { turnedThisTurn.add(`panel:${other.id}`); report.panel.ability = (report.panel.ability || 0) + 1; await panel(i + 1); await sleep(500); continue; }
      }
      await done(); // Pass priority (the big button)
      await sleep(400);
      continue;
    }

    // the same cost asked again and again (a land turned for a colour the cost can't use gives nothing): after 6,
    // pay the way a player gives up on it, with Auto-pay / the pool / Cancel
    // (Forge shows the full cost until it is paid, so a 7-mana spell asks 7 times with the same title: a loop is the
    // same question with the same buttons, i.e. the turned land changed nothing)
    const payKey = p.kind === "mana" ? p.title + "|" + p.options.map((o) => o.id).join(",") : null;
    payRepeat = payKey && payKey === lastPayTitle ? payRepeat + 1 : 0;
    lastPayTitle = payKey;
    // (tap / undo the same lands back and forth also changes the buttons each time: count the cost's questions in a
    // row too; more than its mana value + 8 means it can't be paid. Herigast's {5}{R}{R} with 4 lands asked 1,536
    // times, 2026-10-22)
    payCount = p.kind === "mana" && p.title === payTitle ? payCount + 1 : 0;
    payTitle = p.kind === "mana" ? p.title : null;
    if (p.kind === "mana" && payCount > ((String(p.title).match(/\{/g) || []).length + 8)) {
      const cancel = p.options.find((o) => o.id === "__cancel");
      if (payCount === ((String(p.title).match(/\{/g) || []).length + 9)) report.failed.push({ kind: "pay by turning a land (Q/E)", what: p.title, turn: report.lastTurn, did: "tapped and untapped lands", state: "couldn't pay it", told: "", refused: false });
      if (cancel) { await panel(p.options.indexOf(cancel) + 1); await sleep(500); continue; }
    }
    if (p.kind === "mana" && payRepeat >= 6) {
      const out = p.options.find((o) => o.id === "__auto") || p.options.find((o) => o.id === "__pool") || p.options.find((o) => o.id === "__cancel");
      report.payLoops = (report.payLoops || 0) + (payRepeat === 6 ? 1 : 0);
      if (payRepeat === 6) report.failed.push({ kind: "pay by turning a land (Q/E)", what: p.title, turn: report.lastTurn, did: "turned lands 6 times", state: "the cost was asked again each time", told: "", refused: false });
      if (out) { await panel(p.options.indexOf(out) + 1); await sleep(500); continue; }
    }
    if (p.kind === "mana" && !stuck) {
      // a land whose mana the cost can use (the bridge's rank: 2 needed colour, 1 generic, 0 no use), as a player would
      const taps = p.options.filter((o) => o.id.startsWith("tap:") && !o.sel && o.rank !== 0).sort((a, b) => (b.rank ?? 1) - (a.rank ?? 1));
      const tapOpt = taps[0];
      if (tapOpt) {
        const id = tapOpt.card || tapOpt.id.split(":")[1];
        await gesture("pay by turning a land (Q/E)", tapOpt.label, () => turn(id),
          async (pid0) => (await promptMoved(pid0)) || (await selected((o) => o.id === tapOpt.id)) || /:tapped/.test(await where(id)) || `not paid (${await where(id)})`);
        continue;
      }
      report.panel.pay = (report.panel.pay || 0) + 1;
      await panel(1); await sleep(500); continue;
    }

    if (p.kind === "attack" && !stuck) {
      const attackers = [...new Set(p.options.map((o) => o.id.split("|")[0]).filter((x) => x && !x.startsWith("__")))];
      const att = attackers[Math.floor(Math.random() * attackers.length)];
      if (att && Math.random() < 0.7) {
        const defs = p.options.filter((o) => o.id.startsWith(`${att}|`)).map((o) => o.id.split("|")[1]);
        const player = defs.find((d) => !/^engine-card/.test(d)) || defs[0]; // a player (slot), else a planeswalker
        await gesture("attack: click creature", att, () => click(att), async () => (await selected((o) => o.id.startsWith(`${att}|`))) || "not picked");
        await sleep(500);
        if (player !== undefined) {
          await gesture("attack: click the defender", `${att} -> ${player}`, () => click(/^engine-card/.test(player) ? player : `player|${player}`),
            async () => (await selected((o) => o.id === `${att}|${player}`)) || "not picked");
        }
        await sleep(300);
      }
      await gesture("attack: Done", att || "(none)", () => done(),
        async (pid0) => (await promptMoved(pid0)) || "Done did nothing");
      continue;
    }

    if (p.kind === "block" && !stuck) {
      const opt = p.options.find((o) => o.id.includes("|") && !o.sel && !o.id.startsWith("__"));
      if (opt && Math.random() < 0.7) {
        const [blk, at] = opt.id.split("|");
        await gesture("block: click blocker", blk, () => click(blk), async () => true, 600);
        await sleep(500);
        await gesture("block: click attacker", `${blk} blocks ${at}`, () => click(at), async () => (await selected((o) => o.id === opt.id)) || "not picked");
        await sleep(300);
      }
      await gesture("block: Done", opt ? opt.id : "(none)", () => done(), async (pid0) => (await promptMoved(pid0)) || "Done did nothing");
      continue;
    }

    if (p.kind === "target" && !stuck) {
      const cands = p.options.filter((o) => /^(card|player)\|/.test(o.id) && !o.sel);
      const pick = cands[Math.floor(Math.random() * cands.length)];
      if (pick) {
        const id = pick.id.startsWith("card|") ? pick.id.slice(5) : pick.id;
        // a target in a graveyard/exile pile is pictured in the card row: click its picture
        if (pick.img) {
          await gesture("target: click picture in the card row", `${p.title}: ${pick.label}`, () => panel(p.options.indexOf(pick) + 1),
            async (pid0) => (await promptMoved(pid0)) || (await selected((o) => o.id === pick.id)) || "not picked");
          const after = await prompt();
          if (after && after.id === p.id && after.options.filter((o) => o.sel).length >= Math.max(1, after.min)) await done();
          continue;
        }
        await gesture(pick.id.startsWith("player|") ? "target: click life counter" : "target: click card", `${p.title}: ${pick.label}`, () => click(id),
          async (pid0) => (await promptMoved(pid0)) || (await selected((o) => o.id === pick.id)) || "not picked");
        const after = await prompt();
        if (after && after.id === p.id && after.options.filter((o) => o.sel).length >= Math.max(1, after.min)) await done();
        continue;
      }
    }

    if (p.kind === "cards" && !stuck) {
      const discard = /discard/i.test(p.title);
      const bottom = /bottom/i.test(p.title); // (not "library": Sylvan Library's own choice was taken for one)
      const opt = p.options.find((o) => !o.sel && !o.id.startsWith("__") && (o.card || o.id));
      if (opt) {
        const id = opt.card || opt.id;
        if (discard || bottom) {
          await gesture(discard ? "discard (drag to graveyard)" : "put on library (drag)", opt.label, () => drag(id, discard ? "graveyard" : "library"),
            async (pid0) => (await promptMoved(pid0)) || (await selected((o) => o.id === opt.id)) || /graveyard/.test(await where(id)) || `still ${await where(id)}`);
        } else {
          await gesture("choose: click card", `${p.title}: ${opt.label}`, () => click(id),
            async (pid0) => (await promptMoved(pid0)) || (await selected((o) => o.id === opt.id)) || "not picked");
        }
        const after = await prompt();
        if (after && after.id === p.id && after.options.filter((o) => o.sel).length >= Math.max(1, after.min)) await done();
        continue;
      }
    }

    // "pay ..., or put a chosen card back on top of your library" (Sylvan Library): drag a chosen card onto the
    // library, and check that card left the hand (the bridge answers No and its "which card?" follow-up with it)
    if (!stuck && p.otherwiseDo === "library" && (p.about || []).length) {
      const id = p.about[0];
      await gesture("pay or put back: drag a chosen card onto the library", p.title, () => drag(id, "library"),
        async () => (!/:hand/.test(await where(id)) && (await where(id)) !== "no table") || `still ${await where(id)}`, 6000);
      continue;
    }
    // the panel: everything without a gesture, and a gesture that didn't move things on (stuck)
    report.panel[p.kind] = (report.panel[p.kind] || 0) + 1;
    if (p.mode === "multi") {
      // (only options not picked yet: a click on a picked one un-picks it, and Tangle Wire's "choose 4" after three
      // card clicks looped 1,785 times toggling the same three, 2026-10-22)
      const order = p.options.map((o, i) => [o, i + 1]).filter(([o]) => !o.sel).sort((a, b) => isWanted(b[0].label) - isWanted(a[0].label));
      const have = p.options.filter((o) => o.sel).length;
      let lua = "";
      for (const [, j] of order.slice(0, Math.max(p.min - have, isWanted(order[0]?.[0]?.label) ? 1 : 0))) lua += `onMtgClick(Player.${C}, nil, "o|${C}|${j}") `;
      await exec(lua + `onMtgClick(Player.${C}, nil, "confirm|${C}") return "ok"`);
    } else if (p.mode === "number") {
      await exec(`onMtgClick(Player.${C}, nil, "n|${C}|${p.min}") return "ok"`);
    } else if (/Shuffle your library\?/.test(p.title) && samePid < 2) {
      // (No: then Ponder's draw shows which card the kept order put on top, logged as "order check")
      await panel(2);
    } else {
      await panel(samePid >= 4 ? p.options.length : (samePid >= 2 ? 2 : 1));
    }
    await sleep(400);
    if (step % 4 === 0) await check(`step ${step}`);
  }
  await sleep(1500);
  const final = await check("end");
  report.final = final?.counts;
  console.log(JSON.stringify(report, null, 1));
})();
