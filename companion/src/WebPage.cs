// The status page that WebUi serves at / (inline CSS and JS only: it works offline, and the CSP allows nothing else).
// It is a C# string so the exe stays one file and build.cmd needs no /resource line. The page source has no double
// quote characters (a verbatim string would need each one doubled): attributes and JS strings use single quotes.
// {{TOKEN}} and {{NONCE}} are filled in per request. The API it reads is described at the top of WebUi.cs.
namespace MtgCompanion
{
    public static class WebPage
    {
        public const string Html = @"<!doctype html>
<html lang='en'>
<head>
<meta charset='utf-8'>
<meta name='viewport' content='width=device-width, initial-scale=1'>
<meta id='mtg-token' name='mtg-token' content='{{TOKEN}}'>
<meta name='color-scheme' content='dark'>
<title>MTG Companion</title>
<link rel='icon' href='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E%3Crect x=%222.5%22 y=%220.5%22 width=%2210%22 height=%2214%22 rx=%221.8%22 fill=%22%2326292e%22 stroke=%22%23e1e1e1%22/%3E%3Ccircle cx=%2211.2%22 cy=%2211.2%22 r=%224.2%22 fill=%22%23c8a35a%22 stroke=%22%23fff%22/%3E%3C/svg%3E'>
<style nonce='{{NONCE}}'>
:root {
  --bg: #0f1115; --panel: #181b21; --panel2: #1e222a; --line: #2b3039; --text: #ebe7df; --muted: #a0a7b1;
  --gold: #c8a35a; --gold2: #e2c27f; --ink: #1b1508;
  --green: #3fb950; --amber: #e3a008; --red: #f85149; --blue: #58a6ff; --grey: #7d8590;
}
* { box-sizing: border-box; }
html { background: var(--bg); }
body {
  margin: 0; min-height: 100vh; color: var(--text); font: 15px/1.5 'Segoe UI', system-ui, -apple-system, sans-serif;
  background: radial-gradient(1200px 500px at 50% -200px, #232733 0%, rgba(15,17,21,0) 70%), var(--bg);
}
.wrap { max-width: 920px; margin: 0 auto; padding: 20px 16px 32px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.skip { position: absolute; left: 16px; top: -48px; background: var(--gold); color: var(--ink); padding: 8px 12px; border-radius: 6px; z-index: 5; }
.skip:focus { top: 8px; }
a { color: var(--gold2); }
:focus-visible { outline: 2px solid var(--gold2); outline-offset: 2px; }

header.top { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; padding-bottom: 16px; border-bottom: 1px solid var(--line); }
.brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.brand svg { flex: none; }
h1 { margin: 0; font-size: 21px; letter-spacing: .02em; font-weight: 650; }
h1 span { color: var(--gold); font-weight: 600; }
.phase { margin: 2px 0 0; color: var(--muted); font-size: 13.5px; overflow-wrap: anywhere; }
.pill { display: inline-flex; align-items: center; gap: 9px; padding: 7px 14px 7px 11px; border-radius: 999px; background: var(--panel2); border: 1px solid var(--line); font-weight: 600; }
.pill.red { border-color: rgba(248,81,73,.55); background: rgba(248,81,73,.12); }
.pill.amber { border-color: rgba(227,160,8,.5); background: rgba(227,160,8,.10); }
.pill.green { border-color: rgba(63,185,80,.45); background: rgba(63,185,80,.10); }
.pill.busy { border-color: rgba(88,166,255,.5); background: rgba(88,166,255,.10); }

.dot { width: 14px; height: 14px; border-radius: 50%; flex: none; background: var(--grey); box-shadow: 0 0 0 3px rgba(125,133,144,.18); }
.green > .dot, .pill.green .dot { background: var(--green); box-shadow: 0 0 0 3px rgba(63,185,80,.20), 0 0 10px rgba(63,185,80,.35); }
.amber > .dot, .pill.amber .dot { background: var(--amber); box-shadow: 0 0 0 3px rgba(227,160,8,.20), 0 0 10px rgba(227,160,8,.30); }
.red > .dot, .pill.red .dot { background: var(--red); box-shadow: 0 0 0 3px rgba(248,81,73,.22), 0 0 12px rgba(248,81,73,.45); }
.busy > .dot, .pill.busy .dot { background: var(--blue); box-shadow: 0 0 0 3px rgba(88,166,255,.22); animation: pulse 1.4s ease-in-out infinite; }
@keyframes pulse { 50% { box-shadow: 0 0 0 6px rgba(88,166,255,.05), 0 0 14px rgba(88,166,255,.55); } }
@media (prefers-reduced-motion: reduce) { .busy > .dot, .pill.busy .dot { animation: none; } }

.banner { margin: 16px 0 0; padding: 12px 16px; border-radius: 10px; border: 1px solid var(--line); background: var(--panel); }
.banner strong { display: block; margin-bottom: 2px; }
.banner.game { border-color: rgba(88,166,255,.45); background: linear-gradient(90deg, rgba(88,166,255,.16), rgba(88,166,255,.04)); }
.banner.warn { border-color: rgba(227,160,8,.45); background: linear-gradient(90deg, rgba(227,160,8,.14), rgba(227,160,8,.03)); }
.banner.down { border-color: rgba(248,81,73,.55); background: linear-gradient(90deg, rgba(248,81,73,.18), rgba(248,81,73,.04)); }
.banner.info { color: var(--muted); }
.banner.update { border-color: rgba(200,163,90,.5); }

h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 24px 0 8px; font-weight: 600; }
ol.lights { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--panel); }
.light { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 4px 14px; padding: 14px 16px; border-top: 1px solid var(--line); border-left: 3px solid transparent; }
.light:first-child { border-top: 0; }
.light.red { border-left-color: var(--red); background: rgba(248,81,73,.06); }
.light.amber { border-left-color: rgba(227,160,8,.7); }
.light .dot { justify-self: center; }
.row-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.step { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.name { margin: 0; font-size: 15.5px; font-weight: 650; }
.word { font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 1px 8px; border-radius: 999px; background: var(--panel2); color: var(--muted); }
.green .word { color: var(--green); } .amber .word { color: var(--amber); } .red .word { color: var(--red); } .busy .word { color: var(--blue); }
.at { color: var(--muted); font-size: 12px; margin-left: auto; font-variant-numeric: tabular-nums; }
.text { margin: 2px 0 0; overflow-wrap: anywhere; }

.btn { font: inherit; font-weight: 600; font-size: 14px; color: var(--text); background: var(--panel2); border: 1px solid #3a414c; border-radius: 8px; padding: 8px 14px; cursor: pointer; white-space: nowrap; }
.btn:hover { background: #262b35; border-color: #4a525f; }
.btn.fix { background: var(--gold); border-color: var(--gold2); color: var(--ink); }
.btn.fix:hover { background: var(--gold2); }
.btn.danger { border-color: rgba(248,81,73,.5); }
.btn.danger:hover { background: rgba(248,81,73,.14); }
.btn[aria-disabled='true'] { opacity: .5; cursor: not-allowed; }
.btn[aria-busy='true'] { cursor: progress; }
.btn[aria-disabled='true'].fix { background: var(--panel2); color: var(--muted); border-color: #3a414c; }

.hint { margin: 16px 0 0; padding: 12px 16px; border-radius: 10px; background: var(--panel); border: 1px dashed var(--line); color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.tools { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
.toast { min-height: 1.5em; margin: 12px 0 0; color: var(--muted); white-space: pre-wrap; }
.toast.ok { color: var(--green); } .toast.warn { color: var(--amber); } .toast.bad { color: var(--red); }

details { margin-top: 20px; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); }
summary { cursor: pointer; padding: 10px 16px; font-weight: 600; color: var(--muted); }
summary:hover { color: var(--text); }
.logfile { padding: 0 16px; margin: 0 0 6px; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
pre.log { margin: 0; padding: 12px 16px; max-height: 340px; overflow: auto; border-top: 1px solid var(--line); font: 12.5px/1.45 Consolas, 'Cascadia Mono', ui-monospace, monospace; color: #c9cdd3; white-space: pre-wrap; overflow-wrap: anywhere; }

footer { margin-top: 20px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; color: var(--muted); font-size: 12.5px; }
body.is-down .lights, body.is-down .hint, body.is-down .tools { opacity: .45; filter: grayscale(1); }

@media (max-width: 600px) {
  .light { grid-template-columns: 22px minmax(0, 1fr); }
  .light .btn { grid-column: 2; justify-self: start; margin-top: 6px; }
  .at { margin-left: 0; }
}
</style>
</head>
<body>
<a class='skip' href='#lights'>Skip to the lights</a>
<div class='wrap'>
<header class='top'>
  <div class='brand'>
    <svg width='34' height='34' viewBox='0 0 16 16' aria-hidden='true' focusable='false'><rect x='2.5' y='0.5' width='10' height='14' rx='1.8' fill='#26292e' stroke='#e1e1e1' stroke-width='0.9'/><circle id='logo-dot' cx='11.2' cy='11.2' r='4.2' fill='#7d8590' stroke='#fff' stroke-width='0.9'/></svg>
    <div>
      <h1>MTG <span>Companion</span></h1>
      <p class='phase' id='phase'>Connecting…</p>
    </div>
  </div>
  <div class='pill grey' id='overall' role='status' aria-live='polite' aria-atomic='true'><span class='dot' aria-hidden='true'></span><span id='overall-text'>Connecting…</span></div>
</header>
<main id='main'>
  <div class='banner down' id='down' role='alert' hidden><strong>Companion not running</strong>Start MTG Companion.exe again. This page reconnects by itself.</div>
  <div class='banner warn' id='conn' role='status' aria-live='polite' hidden><strong id='conn-title'>Companion busy, retrying</strong><span id='conn-text'></span></div>
  <div class='banner down' id='pageerr' role='alert' hidden><strong>This page hit an error</strong><span id='pageerr-text'></span></div>
  <div class='banner game' id='game' role='status' aria-live='polite' hidden><strong id='game-title'>Game in progress</strong><span id='game-text'></span></div>
  <div class='banner info' id='observe' hidden>Observe only: this copy reads the lights and changes nothing.</div>
  <div class='banner update' id='update' hidden><strong id='update-title'>Update</strong><span id='update-text'></span><div class='tools' id='update-actions'></div></div>

  <h2 id='lights-h'>Start steps</h2>
  <ol class='lights' id='lights' aria-labelledby='lights-h'></ol>

  <p class='hint' id='hint'></p>

  <h2 id='tools-h'>Actions</h2>
  <div class='tools' id='tools' role='group' aria-labelledby='tools-h'></div>
  <p class='toast' id='toast' role='status' aria-live='polite'></p>

  <details id='logbox'>
    <summary>Log: the last lines of companion.log</summary>
    <p class='logfile' id='logfile'></p>
    <pre class='log' id='log' tabindex='0' aria-label='Log tail'>(empty)</pre>
  </details>
</main>
<footer><span id='versions'></span><span id='updated'></span></footer>
</div>
<script nonce='{{NONCE}}'>
// MtgPage: pure functions (status JSON to a view model, click plans, poll scheduling, headers, the reload guard)
// plus start(env), the only part that touches the DOM, fetch and timers. tests/test_companion_page.js runs this
// script in Node with a stub env. ES5 on purpose (no build step).
var MtgPage = (function () {
  'use strict';
  var NAMES = ['Docker', 'Engine images', 'Engine stack', 'Table save', 'Bridge', 'TTS'];
  var COLORS = { green: '#3fb950', amber: '#e3a008', red: '#f85149', busy: '#58a6ff', grey: '#7d8590' };
  // poll every 2.5 s (30 s in a hidden tab); abort a poll after 6 s; two misses in a row before any connection
  // banner (one slow answer isn't a stopped companion); 'busy, retrying' for the first 10 s of misses, then
  // 'not running'; a stale token reloads the page at most once per 15 s
  var T = { poll: 2500, hidden: 30000, abort: 6000, missesShown: 2, busyFor: 10000, reloadGuard: 15000, repoll: 400 };
  var NOT_RUNNING = 'The companion isn’t running.';

  function str(x) { return x == null ? '' : String(x); }
  function stateOf(x) { return !x ? 'grey' : x.busy ? 'busy' : (x.state || 'grey'); }

  // the connection banner for a poll mode ('ok', 'busy', 'reconnecting' or 'down')
  function connView(mode) {
    if (mode === 'down') return { down: true, banner: false, title: '', text: '' };
    if (mode === 'busy') return { down: false, banner: true, title: 'Companion busy, retrying', text: 'It didn’t answer the last checks. This page keeps trying.' };
    if (mode === 'reconnecting') return { down: false, banner: true, title: 'Reconnecting', text: 'The companion restarted. This page reloads itself in a few seconds.' };
    return { down: false, banner: false, title: '', text: '' };
  }

  // Every button (a light's fix, the menu, the update section's actions) has this one shape:
  // { id, kind, label, locked, lockText, confirm, confirmLocked, disabled, busy, title, aria, danger }.
  // b = { down, inflight }: down disables everything; an id in inflight is disabled until its request answers.
  function lightButton(a, name, b) {
    var busy = !!b.inflight[a.id], locked = !!a.locked, lockText = str(a.lockText);
    return {
      id: a.id, kind: 'fix', label: str(a.label), locked: locked, lockText: lockText, confirm: a.confirm || null, confirmLocked: false,
      disabled: locked || b.down || busy, busy: busy, title: locked ? lockText : '',
      aria: str(a.label) + ' (' + name + ')' + (locked ? '. ' + lockText : ''), danger: false
    };
  }

  function menuButton(m, b) {
    var busy = !!b.inflight[m.id], locked = !m.enabled, lockText = m.title ? String(m.title) : 'Not available now.';
    return {
      id: m.id, kind: 'menu', label: str(m.label), locked: locked, lockText: lockText, confirm: m.confirm || null, confirmLocked: !!m.confirmLocked,
      disabled: locked || b.down || busy, busy: busy, title: str(m.title),
      aria: locked ? str(m.label) + '. ' + lockText : null, danger: m.id === 'stop-everything' || !!m.danger
    };
  }

  function lightView(l, i, b) {
    l = l || {};
    var name = l.name ? String(l.name) : NAMES[i] || 'Step ' + (i + 1);
    return {
      state: stateOf(l), name: name, word: !l.word || l.word === '—' ? 'Not checked' : String(l.word),
      text: l.text == null ? 'Not checked yet.' : String(l.text), at: l.at ? 'checked ' + l.at : '',
      button: l.action ? lightButton(l.action, name, b) : null
    };
  }

  function gameView(g, down) {
    g = g || {};
    var on = g.kind === 'on';
    return {
      shown: !!g.locked && !down, cls: 'banner ' + (on ? 'game' : 'warn'),
      title: on ? 'Game in progress' : 'Can’t tell whether a game is on',
      text: str(g.text) + ' ' + (on ? 'Buttons that restart the engine are locked until the game is over.' : 'Buttons that restart the engine stay locked until it can tell.')
    };
  }

  // the update section (status.update; null today). Its actions use the menu's shape and go through the same
  // click plan and POST /api/action, so a new kind of update needs no new click code.
  function updateView(u, b) {
    if (!u || typeof u !== 'object') return null;
    var acts = u.actions && u.actions.length ? u.actions : [];
    return { title: u.title ? String(u.title) : 'Update', text: str(u.line || u.text), actions: acts.map(function (m) { return menuButton(m, b); }) };
  }

  // status JSON (or null before the first answer) + { mode, inflight } -> everything the page shows
  function viewModel(s, ctx) {
    ctx = ctx || {};
    var conn = connView(ctx.mode), b = { down: conn.down, inflight: ctx.inflight || {} };
    var src = s && s.lights && s.lights.length ? s.lights : NAMES.map(function () { return null; });
    var lights = src.map(function (l, i) { return lightView(l, i, b); });
    var header;
    if (conn.down) header = { state: 'grey', text: 'Companion not running', title: 'MTG Companion (not running)' };
    else if (!s) header = { state: 'grey', text: 'Connecting…', title: 'MTG Companion' };
    else {
      var w = stateOf(s.worst), t = str(s.worst && s.worst.text);
      header = { state: w, text: t, title: (w === 'red' ? '● ' + t + ' · ' : '') + 'MTG Companion' };
    }
    header.color = COLORS[header.state] || COLORS.grey;
    header.phase = !s ? 'Connecting…' : str(s.phase) + (s.mode === 'home' ? ' · home mode (' + s.home + ')' : '');
    var log = s && s.log ? s.log : {}, lines = log.lines || [], v = s && s.versions ? s.versions : {};
    return {
      conn: conn, header: header, game: gameView(s && s.game, conn.down), observe: !!(s && s.observe),
      update: updateView(s && s.update, b), lights: lights,
      menu: (s && s.menu ? s.menu : []).map(function (m) { return menuButton(m, b); }),
      hint: str(s && s.hint),
      log: { text: lines.length ? lines.join('\n') : '(empty)', file: str(log.file) },
      footer: { versions: s ? (v.text ? v.text + ' · ' : '') + 'companion ' + str(v.companion) : '', updated: s ? 'Updated ' + str(s.at) : '' }
    };
  }

  // a click on a button view -> { do: 'none' } | { do: 'say', text, kind } | { do: 'act', id, confirm, confirmLocked }
  function clickPlan(btn, ctx) {
    if (!btn) return { do: 'none' };
    if (ctx.down) return { do: 'say', text: NOT_RUNNING, kind: 'bad' };
    if (ctx.inflight && ctx.inflight[btn.id]) return { do: 'say', text: 'Already sent; waiting for the companion.', kind: '' };
    if (btn.locked) return { do: 'say', text: btn.lockText, kind: 'warn' };
    return { do: 'act', id: btn.id, confirm: btn.confirm, confirmLocked: btn.confirmLocked };
  }

  // the answer to POST /api/action -> { do: 'confirm', text } (ask, then send again with confirmLocked) | { do: 'say' }
  function answerPlan(res) {
    res = res || {};
    if (res.needConfirm) return { do: 'confirm', text: str(res.message) + '\n\nStop anyway?' };
    return { do: 'say', text: res.message || (res.ok ? 'Done.' : 'Refused.'), kind: res.ok ? 'ok' : 'warn' };
  }

  // one poll's outcome ('ok', 'stale' = 403 bad-token, or 'fail') -> the next connection state, whether to reload,
  // and the delay before the next poll. conn = { misses, since (time of the first miss in a row, or null), mode }.
  function afterPoll(conn, outcome, now, hidden, reloadOk) {
    var c = { misses: 0, since: null, mode: 'ok' }, reload = false;
    if (outcome === 'stale') { c.mode = 'reconnecting'; reload = !!reloadOk; }
    else if (outcome !== 'ok') {
      c.misses = conn.misses + 1;
      c.since = conn.since == null ? now : conn.since;
      c.mode = c.misses < T.missesShown ? conn.mode : now - c.since < T.busyFor ? 'busy' : 'down';
    }
    return { conn: c, reload: reload, delay: hidden ? T.hidden : T.poll };
  }

  // the stale-token reload runs at most once per 15 s (a companion restarting twice must not loop the page)
  function reloadAllowed(last, now) { return !(now - last < T.reloadGuard); }

  function headers(token, json) {
    var h = { 'X-MTG-Token': token };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  // env: { document, fetch, setTimeout, clearTimeout, now, hidden, confirm, reload, storage: { get, set },
  //        onVisible, AbortController }
  function start(env) {
    var doc = env.document;
    var st = {
      token: doc.getElementById('mtg-token').getAttribute('content'), last: null,
      conn: { misses: 0, since: null, mode: 'ok' }, inflight: {}, timer: null, seq: 0,
      rows: [], menuBtns: {}, updateBtns: {}
    };
    function $(id) { return doc.getElementById(id); }
    function el(tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
    function set(e, text) { text = str(text); if (e.textContent !== text) e.textContent = text; }
    function say(text, kind) { var t = $('toast'); t.className = 'toast' + (kind ? ' ' + kind : ''); set(t, text); }

    function paint(e, v) {
      e.className = 'btn' + (v.kind === 'fix' ? ' fix' : '') + (v.danger ? ' danger' : '');
      set(e, v.label);
      e.setAttribute('aria-disabled', v.disabled ? 'true' : 'false');
      e.setAttribute('aria-busy', v.busy ? 'true' : 'false');
      e.title = v.title;
      if (v.aria) e.setAttribute('aria-label', v.aria); else e.removeAttribute('aria-label');
    }

    function newButton(holder) {
      var e = el('button', 'btn'); e.type = 'button';
      e.addEventListener('click', function () { press(holder.view); });
      return e;
    }

    function addRow(i) {
      var li = el('li', 'light grey');
      var dot = el('span', 'dot'); dot.setAttribute('aria-hidden', 'true');
      var main = el('div', 'body'), head = el('div', 'row-head');
      var step = el('span', 'step', (i + 1) + '.'); step.setAttribute('aria-hidden', 'true');
      var r = { li: li, name: el('h3', 'name'), word: el('span', 'word'), at: el('span', 'at'), text: el('p', 'text'), view: null };
      head.appendChild(step); head.appendChild(r.name); head.appendChild(r.word); head.appendChild(r.at);
      main.appendChild(head); main.appendChild(r.text);
      r.btn = newButton(r); r.btn.hidden = true;
      li.appendChild(dot); li.appendChild(main); li.appendChild(r.btn);
      $('lights').appendChild(li);
      st.rows.push(r);
      return r;
    }

    // one button per id, created once and repainted; ids no longer listed are hidden
    function syncButtons(box, list, map) {
      var seen = {};
      list.forEach(function (v) {
        var h = map[v.id];
        if (!h) { h = { view: null }; h.el = newButton(h); box.appendChild(h.el); map[v.id] = h; }
        h.view = v; h.el.hidden = false; paint(h.el, v); seen[v.id] = true;
      });
      Object.keys(map).forEach(function (k) { if (!seen[k]) map[k].el.hidden = true; });
    }

    function apply(vm) {
      var h = vm.header;
      $('overall').className = 'pill ' + h.state;
      set($('overall-text'), h.text);
      $('logo-dot').setAttribute('fill', h.color);
      if (doc.title !== h.title) doc.title = h.title;
      set($('phase'), h.phase);
      doc.body.className = vm.conn.down ? 'is-down' : '';
      $('down').hidden = !vm.conn.down;
      $('conn').hidden = !vm.conn.banner;
      set($('conn-title'), vm.conn.title);
      set($('conn-text'), vm.conn.text);
      var g = vm.game, gb = $('game');
      gb.hidden = !g.shown;
      if (g.shown) { gb.className = g.cls; set($('game-title'), g.title); set($('game-text'), g.text); }
      $('observe').hidden = !vm.observe;
      var u = vm.update;
      $('update').hidden = !u;
      if (u) { set($('update-title'), u.title); set($('update-text'), u.text); }
      syncButtons($('update-actions'), u ? u.actions : [], st.updateBtns);
      vm.lights.forEach(function (lv, i) {
        var r = st.rows[i] || addRow(i);
        r.li.hidden = false;
        r.li.className = 'light ' + lv.state;
        set(r.name, lv.name); set(r.word, lv.word); set(r.text, lv.text); set(r.at, lv.at);
        r.view = lv.button;
        r.btn.hidden = !lv.button;
        if (lv.button) paint(r.btn, lv.button);
      });
      for (var k = vm.lights.length; k < st.rows.length; k++) st.rows[k].li.hidden = true;
      set($('hint'), vm.hint);
      syncButtons($('tools'), vm.menu, st.menuBtns);
      var pre = $('log'), atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
      if (pre.textContent !== vm.log.text) { pre.textContent = vm.log.text; if (atEnd) pre.scrollTop = pre.scrollHeight; }
      set($('logfile'), vm.log.file);
      set($('versions'), vm.footer.versions);
      set($('updated'), vm.footer.updated);
    }

    function showError(e) {
      try {
        $('pageerr').hidden = false;
        set($('pageerr-text'), 'Reload the page (F5) if this stays. ' + (e && e.message ? e.message : str(e)));
      } catch (x) { }
    }

    // draw throws are caught here and shown; they never stop the polling
    function draw() {
      try {
        apply(viewModel(st.last, { mode: st.conn.mode, inflight: st.inflight }));
        $('pageerr').hidden = true;
      } catch (e) { showError(e); }
    }

    function schedule(ms) { env.clearTimeout(st.timer); st.timer = env.setTimeout(poll, ms); }

    function press(v) {
      var p = clickPlan(v, { down: connView(st.conn.mode).down, inflight: st.inflight });
      if (p.do === 'say') { say(p.text, p.kind); return; }
      if (p.do !== 'act') return;
      if (p.confirm && !env.confirm(p.confirm)) return;
      act(p.id, p.confirmLocked);
    }

    function act(id, confirmLocked) {
      st.inflight[id] = true;
      draw();
      say('Working…', '');
      new Promise(function (ok) {
        ok(env.fetch('/api/action', {
          method: 'POST', cache: 'no-store', credentials: 'same-origin',
          headers: headers(st.token, true), body: JSON.stringify({ id: id, confirmLocked: !!confirmLocked })
        }));
      }).then(function (r) { return r.json(); }).then(function (res) {
        delete st.inflight[id];
        draw();
        var a = answerPlan(res);
        if (a.do === 'confirm') { if (env.confirm(a.text)) act(id, true); else say('Nothing was changed.', ''); return; }
        say(a.text, a.kind);
        schedule(T.repoll);
      }, function () {
        delete st.inflight[id];
        draw();
        say('The companion didn’t answer.', 'bad');
      });
    }

    function poll() {
      env.clearTimeout(st.timer);
      st.timer = null;
      var my = ++st.seq, outcome = 'fail', data = null, guard = null;
      try {
        var ctl = env.AbortController ? new env.AbortController() : null;
        guard = env.setTimeout(function () { if (ctl) ctl.abort(); }, T.abort);
        env.fetch('/api/status', { headers: headers(st.token, false), cache: 'no-store', credentials: 'same-origin', signal: ctl ? ctl.signal : undefined })
          .then(function (r) {
            return r.json().then(function (j) {
              if (r.status === 403 && j && j.error === 'bad-token') outcome = 'stale';
              else if (r.ok && j && j.lights) { outcome = 'ok'; data = j; }
            });
          })
          .then(null, function () { outcome = 'fail'; })
          .then(function () { env.clearTimeout(guard); finish(my, outcome, data); });
      } catch (e) { env.clearTimeout(guard); finish(my, 'fail', null); }
    }

    // the next poll is always armed (finally), whatever the answer or a draw did
    function finish(my, outcome, data) {
      if (my !== st.seq) return; // (a newer poll started meanwhile and owns the timer)
      var delay = T.poll;
      try {
        var now = env.now();
        var p = afterPoll(st.conn, outcome, now, env.hidden(), reloadAllowed(+env.storage.get('mtg-reload') || 0, now));
        st.conn = p.conn;
        delay = p.delay;
        if (data) st.last = data;
        if (p.reload) { env.storage.set('mtg-reload', String(now)); env.reload(); }
        apply(viewModel(st.last, { mode: st.conn.mode, inflight: st.inflight }));
        $('pageerr').hidden = true;
      } catch (e) { showError(e); }
      finally { st.timer = env.setTimeout(poll, delay); }
    }

    NAMES.forEach(function (n, i) { addRow(i); });
    draw();
    env.onVisible(poll);
    poll();
    return { poll: poll, state: st };
  }

  return {
    T: T, NAMES: NAMES, stateOf: stateOf, connView: connView, lightButton: lightButton, menuButton: menuButton,
    lightView: lightView, gameView: gameView, updateView: updateView, viewModel: viewModel, clickPlan: clickPlan,
    answerPlan: answerPlan, afterPoll: afterPoll, reloadAllowed: reloadAllowed, headers: headers, start: start
  };
})();

if (typeof document !== 'undefined' && document.getElementById('mtg-token')) {
  MtgPage.start({
    document: document,
    fetch: function (u, o) { return window.fetch(u, o); },
    setTimeout: function (f, ms) { return window.setTimeout(f, ms); },
    clearTimeout: function (t) { window.clearTimeout(t); },
    now: function () { return Date.now(); },
    hidden: function () { return !!document.hidden; },
    confirm: function (t) { return window.confirm(t); },
    reload: function () { window.location.reload(); },
    storage: {
      get: function (k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { } }
    },
    onVisible: function (f) { document.addEventListener('visibilitychange', function () { if (!document.hidden) f(); }); },
    AbortController: window.AbortController
  });
}
</script>
</body>
</html>
";
    }
}
