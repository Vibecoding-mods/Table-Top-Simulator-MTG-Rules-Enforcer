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
<meta name='mtg-token' content='{{TOKEN}}'>
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
  <div class='banner game' id='game' role='status' aria-live='polite' hidden><strong id='game-title'>Game in progress</strong><span id='game-text'></span></div>
  <div class='banner info' id='observe' hidden>Observe only: this copy reads the lights and changes nothing.</div>
  <div class='banner update' id='update' hidden><strong>Update</strong><span id='update-text'></span></div>

  <h2 id='lights-h'>Start steps</h2>
  <ol class='lights' id='lights' aria-labelledby='lights-h'></ol>

  <p class='hint' id='hint' aria-label='Help'></p>

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
(function () {
  'use strict';
  var TOKEN = document.querySelector('meta[name=mtg-token]').getAttribute('content');
  var NAMES = ['Docker', 'Engine images', 'Engine stack', 'Table save', 'Bridge', 'TTS'];
  var COLORS = { green: '#3fb950', amber: '#e3a008', red: '#f85149', busy: '#58a6ff', grey: '#7d8590' };
  var rows = [], menuBtns = {}, last = null, isDown = false, timer = null, misses = 0;

  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function set(e, text) { text = text == null ? '' : String(text); if (e.textContent !== text) e.textContent = text; }
  function stateOf(x) { return x.busy ? 'busy' : x.state; }

  function makeRow(i) {
    var li = el('li', 'light grey');
    var dot = el('span', 'dot'); dot.setAttribute('aria-hidden', 'true');
    var main = el('div', 'body');
    var head = el('div', 'row-head');
    var step = el('span', 'step', (i + 1) + '.'); step.setAttribute('aria-hidden', 'true');
    var name = el('h3', 'name', NAMES[i]);
    var word = el('span', 'word', 'Not checked');
    var at = el('span', 'at');
    head.appendChild(step); head.appendChild(name); head.appendChild(word); head.appendChild(at);
    var text = el('p', 'text', 'Not checked yet.');
    main.appendChild(head); main.appendChild(text);
    var btn = el('button', 'btn fix'); btn.type = 'button'; btn.hidden = true;
    btn.addEventListener('click', function () { onFix(i); });
    li.appendChild(dot); li.appendChild(main); li.appendChild(btn);
    rows.push({ li: li, word: word, at: at, text: text, btn: btn, name: name });
    return li;
  }

  function say(text, kind) { var t = $('toast'); t.className = 'toast' + (kind ? ' ' + kind : ''); set(t, text); }

  function post(body) {
    return fetch('/api/action', {
      method: 'POST', cache: 'no-store', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-MTG-Token': TOKEN },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json(); });
  }

  function act(id, confirmLocked) {
    say('Working…', '');
    post({ id: id, confirmLocked: !!confirmLocked }).then(function (res) {
      if (res.needConfirm) {
        if (window.confirm(res.message + '\n\nStop anyway?')) { act(id, true); return; }
        say('Nothing was changed.', '');
        return;
      }
      say(res.message || (res.ok ? 'Done.' : 'Refused.'), res.ok ? 'ok' : 'warn');
      setTimeout(poll, 400);
    }, function () { say('The companion didn’t answer.', 'bad'); });
  }

  function onFix(i) {
    if (isDown) { say('The companion isn’t running.', 'bad'); return; }
    var a = last && last.lights[i] && last.lights[i].action;
    if (!a) return;
    if (a.locked) { say(a.lockText, 'warn'); return; }
    if (a.confirm && !window.confirm(a.confirm)) return;
    act(a.id, false);
  }

  function menuItem(id) {
    var ms = (last && last.menu) || [];
    for (var k = 0; k < ms.length; k++) if (ms[k].id === id) return ms[k];
    return null;
  }

  function onMenu(id) {
    if (isDown) { say('The companion isn’t running.', 'bad'); return; }
    var m = menuItem(id);
    if (!m) return;
    if (!m.enabled) { say(m.title || 'Not available now.', 'warn'); return; }
    if (m.confirm && !window.confirm(m.confirm)) return;
    act(m.id, m.confirmLocked);
  }

  function renderMenu(menu) {
    var box = $('tools');
    menu.forEach(function (m) {
      var b = menuBtns[m.id];
      if (!b) {
        b = el('button', 'btn' + (m.id === 'stop-everything' ? ' danger' : '')); b.type = 'button';
        b.addEventListener('click', function () { onMenu(m.id); });
        box.appendChild(b); menuBtns[m.id] = b;
      }
      set(b, m.label);
      b.setAttribute('aria-disabled', m.enabled && !isDown ? 'false' : 'true');
      b.title = m.title || '';
    });
  }

  function render(s) {
    last = s;
    var w = stateOf(s.worst);
    $('overall').className = 'pill ' + w;
    set($('overall-text'), s.worst.text);
    $('logo-dot').setAttribute('fill', COLORS[w] || COLORS.grey);
    document.title = (w === 'red' ? '● ' + s.worst.text + ' · ' : '') + 'MTG Companion';
    set($('phase'), s.phase + (s.mode === 'home' ? ' · home mode (' + s.home + ')' : ''));

    var g = s.game, gb = $('game');
    gb.hidden = !g.locked;
    if (g.locked) {
      gb.className = 'banner ' + (g.kind === 'on' ? 'game' : 'warn');
      set($('game-title'), g.kind === 'on' ? 'Game in progress' : 'Can’t tell whether a game is on');
      set($('game-text'), g.text + ' ' + (g.kind === 'on' ? 'Buttons that restart the engine are locked until the game is over.' : 'Buttons that restart the engine stay locked until it can tell.'));
    }
    $('observe').hidden = !s.observe;
    var u = s.update && typeof s.update === 'object' ? s.update : null;
    $('update').hidden = !u;
    if (u) set($('update-text'), u.line || u.text || '');

    s.lights.forEach(function (l, i) {
      var r = rows[i];
      if (!r) return;
      var st = stateOf(l);
      r.li.className = 'light ' + st;
      set(r.name, l.name);
      set(r.word, l.word === '—' ? 'Not checked' : l.word);
      set(r.text, l.text);
      set(r.at, l.at ? 'checked ' + l.at : '');
      var a = l.action;
      r.btn.hidden = !a;
      if (a) {
        set(r.btn, a.label);
        r.btn.setAttribute('aria-disabled', a.locked ? 'true' : 'false');
        r.btn.title = a.locked ? a.lockText : '';
        r.btn.setAttribute('aria-label', a.label + ' (' + l.name + ')' + (a.locked ? ', locked: ' + a.lockText : ''));
      }
    });
    set($('hint'), s.hint);
    renderMenu(s.menu);

    var pre = $('log'), atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
    var txt = s.log.lines.length ? s.log.lines.join('\n') : '(empty)';
    if (pre.textContent !== txt) { pre.textContent = txt; if (atEnd) pre.scrollTop = pre.scrollHeight; }
    set($('logfile'), s.log.file || '');
    set($('versions'), (s.versions.text ? s.versions.text + ' · ' : '') + 'companion ' + s.versions.companion);
    set($('updated'), 'Updated ' + s.at);
  }

  function down() {
    if (!isDown) {
      isDown = true;
      document.body.classList.add('is-down');
      $('down').hidden = false;
      $('game').hidden = true;
      $('overall').className = 'pill grey';
      set($('overall-text'), 'Companion not running');
      $('logo-dot').setAttribute('fill', COLORS.grey);
      document.title = 'MTG Companion (not running)';
      Object.keys(menuBtns).forEach(function (k) { menuBtns[k].setAttribute('aria-disabled', 'true'); });
      rows.forEach(function (r) { r.btn.setAttribute('aria-disabled', 'true'); });
    }
  }

  function up() {
    if (isDown) { isDown = false; document.body.classList.remove('is-down'); $('down').hidden = true; }
  }

  // a 403 bad-token: the companion was restarted (new token), so this page is stale; reload at most every 15 s
  function reloadOnce() {
    var t = 0;
    try { t = +sessionStorage.getItem('mtg-reload') || 0; } catch (e) { }
    if (Date.now() - t < 15000) return false;
    try { sessionStorage.setItem('mtg-reload', String(Date.now())); } catch (e) { }
    location.reload();
    return true;
  }

  // (two misses in a row before 'not running': one slow answer, e.g. in a background tab, isn't a stopped companion)
  function missed() { misses++; if (misses >= 2) down(); }

  function poll() {
    clearTimeout(timer);
    var ctl = window.AbortController ? new AbortController() : null;
    var guard = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
    fetch('/api/status', { headers: { 'X-MTG-Token': TOKEN }, cache: 'no-store', credentials: 'same-origin', signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        return r.json().then(function (j) {
          if (r.status === 403 && j && j.error === 'bad-token' && reloadOnce()) throw new Error('reloading');
          if (!r.ok) throw new Error((j && j.message) || ('HTTP ' + r.status));
          return j;
        });
      })
      .then(function (s) { misses = 0; up(); render(s); }, missed)
      .then(function () { clearTimeout(guard); timer = setTimeout(poll, document.hidden ? 30000 : 2500); });
  }

  for (var i = 0; i < NAMES.length; i++) $('lights').appendChild(makeRow(i));
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  poll();
})();
</script>
</body>
</html>
";
    }
}
