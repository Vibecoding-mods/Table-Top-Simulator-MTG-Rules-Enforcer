// The status page that WebUi serves at / (inline CSS and JS only: it works offline, and the CSP allows nothing else).
// It is a C# string so the exe stays one file and build.cmd needs no /resource line. The page source has no double
// quote characters (a verbatim string would need each one doubled): attributes and JS strings use single quotes, and
// the icons' data: URLs spell theirs %22. {{TOKEN}} and {{NONCE}} are filled in per request. The API it reads is
// described at the top of WebUi.cs. Every icon and mana pip here is drawn for this page (no outside artwork).
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
  --bg: #08080c; --panel: rgba(22,22,31,.94); --panel2: #1f202c; --line: #30324a; --text: #eeeae2; --muted: #b3b7c1;
  --gold: #d2ae63; --gold2: #ecd08e; --ink: #1b1508;
  --green: #4cc35e; --amber: #f0b429; --red: #ff6b61; --blue: #6cb2ff; --grey: #8d949e;
  --mw: #f2e9cc; --mu: #4f95e0; --mb: #a99bb0; --mr: #e3664d; --mg: #55b06c;
  --i-lock: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222.2%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M8 11V8a4 4 0 0 1 8 0v3M6 11h12v9H6z%22/%3E%3C/svg%3E');
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }
/* the five-colour backdrop: saturated glows of white, blue, black, red and green mana on a near-black base (the user
   liked the colours and asked for them saturated, 2026-11-13). The base sits on html, which paints the canvas under
   every layer; body stays clear, or its own background box would cover the glow layer (z-index -1) below. */
html { background-color: var(--bg); background-image: linear-gradient(160deg, #0e0e16, #060609); background-attachment: fixed; }
body { margin: 0; min-height: 100vh; color: var(--text); font: 15px/1.5 'Segoe UI', system-ui, -apple-system, sans-serif; }
/* the five glows are blobs on a fixed layer behind the page: they drift toward the pointer while it moves and blend
   where they meet (screen), then ease back to their corners when it stops (MtgPage.manaDrift; the wiring is at the end
   of the script). Each blob is the old radial-gradient's ellipse: twice its radii times its fade stop, centred where
   the gradient was. */
.mana { position: fixed; inset: 0; z-index: -1; pointer-events: none; overflow: hidden; }
.blob { position: absolute; border-radius: 50%; mix-blend-mode: screen; transform: translate3d(0, 0, 0) scale(1); }
@media (prefers-reduced-motion: no-preference) { .blob { will-change: transform; transition: transform 1.8s cubic-bezier(.22, .7, .2, 1); } .mana.moving .blob { transition-duration: .9s; } }
.blob.w { left: -640px; top: -448px; width: 1280px; height: 896px; background: radial-gradient(closest-side, rgba(255,246,215,.46), rgba(255,246,215,0)); }
.blob.u { right: -533px; top: -384px; width: 1066px; height: 769px; background: radial-gradient(closest-side, rgba(25,120,255,.42), rgba(25,120,255,0)); }
.blob.b { left: 50%; top: 50%; margin: -501px 0 0 -660px; width: 1320px; height: 1003px; background: radial-gradient(closest-side, rgba(130,40,200,.32), rgba(130,40,200,0)); }
.blob.r { left: -533px; bottom: -397px; width: 1066px; height: 794px; background: radial-gradient(closest-side, rgba(255,55,25,.40), rgba(255,55,25,0)); }
.blob.g { right: -533px; bottom: -397px; width: 1066px; height: 794px; background: radial-gradient(closest-side, rgba(20,200,70,.38), rgba(20,200,70,0)); }
.wrap { max-width: 1440px; margin: 0 auto; padding: 20px 16px 32px; }
.cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0 28px; align-items: start; }
.col { min-width: 0; }
@media (max-width: 1000px) { .cols { grid-template-columns: minmax(0, 1fr); } }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.skip { position: absolute; left: 16px; top: -60px; background: var(--gold); color: var(--ink); padding: 10px 14px; border-radius: 8px; z-index: 60; font-weight: 600; }
.skip:focus { top: 8px; }
a { color: var(--gold2); }
:focus-visible { outline: 2px solid var(--gold2); outline-offset: 2px; }

/* cards: every panel is a dark, slightly translucent card with a thin five-colour edge on top */
.card { position: relative; background: linear-gradient(180deg, rgba(30,30,42,.95), rgba(19,19,27,.95)); border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 12px 32px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.04); }
.card::before { content: ''; position: absolute; left: 16px; right: 16px; top: -1px; height: 2px; border-radius: 2px; opacity: .7; pointer-events: none;
  background: linear-gradient(90deg, var(--mw), var(--mu), var(--mb), var(--mr), var(--mg)); }
.pad { padding: 16px; }

/* icons: one mask per name, painted in the text colour (drawn for this page) */
[data-icon] { --i: none; }
.sico, .h-ico, .sum-ico { display: inline-block; flex: none; width: 20px; height: 20px; background: var(--gold2); -webkit-mask: var(--i) center / contain no-repeat; mask: var(--i) center / contain no-repeat; }
[data-icon='restart'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5%22/%3E%3C/svg%3E'); }
[data-icon='untap'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5%22/%3E%3C/svg%3E'); }
[data-icon='stop'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M7 6h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z%22/%3E%3C/svg%3E'); }
[data-icon='folder'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z%22/%3E%3C/svg%3E'); }
[data-icon='cpu'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M8 7h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1zM10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4%22/%3E%3C/svg%3E'); }
[data-icon='download'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M12 4v11M7 10l5 5 5-5M5 20h14%22/%3E%3C/svg%3E'); }
[data-icon='clock'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 7v5l3 2%22/%3E%3C/svg%3E'); }
[data-icon='search'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M11 5a6 6 0 1 0 0 12a6 6 0 1 0 0-12zM20 20l-4.6-4.6%22/%3E%3C/svg%3E'); }
[data-icon='play'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M8 5v14l11-7z%22/%3E%3C/svg%3E'); }
[data-icon='layers'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M12 3l9 5-9 5-9-5zM3 13l9 5 9-5%22/%3E%3C/svg%3E'); }
[data-icon='open'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5%22/%3E%3C/svg%3E'); }
[data-icon='window'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM3 9h18%22/%3E%3C/svg%3E'); }
[data-icon='wrench'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M15 4a5 5 0 0 0-5.6 6.4L4 15.8V20h4.2l5.4-5.4A5 5 0 0 0 20 9l-3 3-3-1-1-3z%22/%3E%3C/svg%3E'); }
[data-icon='drop'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M12 3c3 4.5 6 7.5 6 11a6 6 0 0 1-12 0c0-3.5 3-6.5 6-11z%22/%3E%3C/svg%3E'); }
[data-icon='hand'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M9 4h9a1 1 0 0 1 1 1v12M6 7h9a1 1 0 0 1 1 1v12H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z%22/%3E%3C/svg%3E'); }
[data-icon='field'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M8 3h8a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM3 21h18%22/%3E%3C/svg%3E'); }
[data-icon='heart'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z%22/%3E%3C/svg%3E'); }
[data-icon='draw'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M5 9h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1zM18 12V3M15 6l3-3 3 3%22/%3E%3C/svg%3E'); }
[data-icon='mill'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M5 3h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM18 12v9M15 18l3 3 3-3%22/%3E%3C/svg%3E'); }
[data-icon='check'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222.4%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M5 12l5 5 9-10%22/%3E%3C/svg%3E'); }
[data-icon='cube'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5%22/%3E%3C/svg%3E'); }
[data-icon='gear'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1%22/%3E%3C/svg%3E'); }
[data-icon='disk'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 3v5h7V3M7 21v-7h10v7%22/%3E%3C/svg%3E'); }
[data-icon='bridge'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M2 17h20M2 12c3 0 6-4 10-4s7 4 10 4M6 17v-5.5M12 17V8M18 17v-5.5%22/%3E%3C/svg%3E'); }
[data-icon='dice'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z%22/%3E%3Cpath stroke-width=%223%22 d=%22M9 9h.01M15 15h.01M12 12h.01M15 9h.01M9 15h.01%22/%3E%3C/svg%3E'); }
[data-icon='spark'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2zM19 3v4M17 5h4%22/%3E%3C/svg%3E'); }
[data-icon='log'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3%22/%3E%3C/svg%3E'); }
[data-icon='steps'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M5 5a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3zM5 16a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3zM10 6.5h10M10 17.5h10M5 9.5v5%22/%3E%3C/svg%3E'); }
[data-icon='bolt'] { --i: url('data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%23000%22 stroke-width=%222%22 stroke-linecap=%22round%22 stroke-linejoin=%22round%22%3E%3Cpath d=%22M13 2L4 14h7l-1 8 9-12h-7z%22/%3E%3C/svg%3E'); }

header.top { display: flex; align-items: center; justify-content: space-between; gap: 14px 20px; flex-wrap: wrap; padding: 18px 20px; }
.brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
.brand svg { flex: none; filter: drop-shadow(0 0 10px rgba(210,174,99,.35)); }
h1 { margin: 0; font-size: 24px; letter-spacing: .02em; font-weight: 700; line-height: 1.2; }
.shimmer { color: var(--gold); font-weight: 650;
  background: linear-gradient(100deg, #d2ae63 0%, #d2ae63 35%, #fff1c9 50%, #d2ae63 65%, #d2ae63 100%); background-size: 260% 100%; background-position: 100% 0;
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
@media (prefers-reduced-motion: no-preference) { .shimmer { animation: shimmer 7s ease-in-out infinite; } }
@keyframes shimmer { 0% { background-position: 100% 0; } 55% { background-position: 0% 0; } 100% { background-position: 0% 0; } }
@media (forced-colors: active) { .shimmer { -webkit-text-fill-color: currentColor; background: none; } }
.tagline { margin: 2px 0 0; color: var(--muted); font-size: 13.5px; }
.phase { margin: 4px 0 0; color: var(--text); font-size: 14px; overflow-wrap: anywhere; }
.head-right { display: flex; align-items: center; gap: 12px 16px; flex-wrap: wrap; }
.pips { display: flex; gap: 6px; }
.pip { width: 26px; height: 26px; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,.6), 0 2px 8px rgba(0,0,0,.5); }
.pill { display: inline-flex; align-items: center; gap: 10px; min-height: 40px; padding: 8px 16px 8px 12px; border-radius: 999px; background: var(--panel2); border: 1px solid var(--line); font-weight: 650; }
.pill.red { border-color: rgba(255,107,97,.6); background: #3a1a1d; }
.pill.amber { border-color: rgba(240,180,41,.55); background: #33290f; }
.pill.green { border-color: rgba(76,195,94,.5); background: #15301c; }
.pill.busy { border-color: rgba(108,178,255,.55); background: #172a40; }

.dot { width: 14px; height: 14px; border-radius: 50%; flex: none; background: var(--grey); box-shadow: 0 0 0 3px rgba(141,148,158,.18); }
.green > .dot, .pill.green .dot { background: var(--green); box-shadow: 0 0 0 3px rgba(76,195,94,.22), 0 0 12px rgba(76,195,94,.45); }
.amber > .dot, .pill.amber .dot { background: var(--amber); box-shadow: 0 0 0 3px rgba(240,180,41,.22), 0 0 12px rgba(240,180,41,.38); }
.red > .dot, .pill.red .dot { background: var(--red); box-shadow: 0 0 0 3px rgba(255,107,97,.24), 0 0 14px rgba(255,107,97,.5); }
.busy > .dot, .pill.busy .dot { background: var(--blue); box-shadow: 0 0 0 3px rgba(108,178,255,.24); }
@media (prefers-reduced-motion: no-preference) { .busy > .dot, .pill.busy .dot { animation: pulse 1.4s ease-in-out infinite; } }
@keyframes pulse { 50% { box-shadow: 0 0 0 6px rgba(108,178,255,.05), 0 0 16px rgba(108,178,255,.6); } }

.banner { margin: 16px 0 0; padding: 12px 16px; border-radius: 12px; border: 1px solid var(--line); background: var(--panel); }
.banner strong { display: block; margin-bottom: 2px; }
.banner.game { border-color: rgba(108,178,255,.5); background: linear-gradient(90deg, #172a40, #14161f); }
.banner.warn { border-color: rgba(240,180,41,.5); background: linear-gradient(90deg, #33290f, #14161f); }
.banner.down { border-color: rgba(255,107,97,.6); background: linear-gradient(90deg, #3a1a1d, #14161f); }
.banner.info { color: var(--muted); }
.banner.update { border-color: rgba(210,174,99,.55); background: linear-gradient(90deg, #2c2414, #14161f); }

h2 { display: flex; align-items: center; gap: 10px; font-size: 18px; letter-spacing: .01em; color: var(--text); margin: 26px 0 2px; font-weight: 650; }
.help { margin: 0 0 12px; color: var(--muted); font-size: 14px; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 16px; list-style: none; margin: 0 0 10px; padding: 0; font-size: 13px; color: var(--muted); }
.legend li { display: inline-flex; align-items: center; gap: 7px; }
.legend .dot { width: 10px; height: 10px; }

ol.lights { list-style: none; margin: 0; padding: 0; overflow: hidden; }
.light { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; align-items: center; gap: 6px 14px; min-height: 70px; padding: 14px 16px; border-top: 1px solid var(--line); border-left: 4px solid transparent; }
.light:first-child { border-top: 0; }
.light.green { border-left-color: rgba(76,195,94,.75); background: rgba(76,195,94,.04); }
.light.red { border-left-color: var(--red); background: rgba(255,107,97,.09); }
.light.amber { border-left-color: var(--amber); background: rgba(240,180,41,.06); }
.light.busy { border-left-color: var(--blue); background: rgba(108,178,255,.06); }
.light .dot { justify-self: center; }
.row-head { display: flex; align-items: center; gap: 8px 10px; flex-wrap: wrap; }
.row-head .sico { width: 18px; height: 18px; background: var(--muted); }
.step { color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
.name { margin: 0; font-size: 16px; font-weight: 650; }
.word { font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 2px 9px; border-radius: 999px; background: var(--panel2); color: var(--grey); border: 1px solid var(--line); }
.green .word { color: var(--green); } .amber .word { color: var(--amber); } .red .word { color: var(--red); } .busy .word { color: var(--blue); }
.at { color: var(--muted); font-size: 12px; margin-left: auto; font-variant-numeric: tabular-nums; }
.text { margin: 4px 0 0; overflow-wrap: anywhere; }

/* buttons: big targets, an icon each, a lock when they can't be used now */
.btn { display: inline-flex; align-items: center; gap: 9px; min-height: 44px; font: inherit; font-weight: 600; font-size: 14.5px; color: var(--text);
  background: linear-gradient(180deg, #2a2c3d, #20222f); border: 1px solid #44475e; border-radius: 10px; padding: 10px 16px; cursor: pointer; white-space: nowrap; text-align: left; }
.btn::before { content: ''; display: none; flex: none; width: 18px; height: 18px; background: currentColor; -webkit-mask: var(--i) center / contain no-repeat; mask: var(--i) center / contain no-repeat; }
.btn[data-icon]::before { display: inline-block; }
.btn:hover { background: linear-gradient(180deg, #33364b, #282b3a); border-color: var(--gold); box-shadow: 0 0 0 1px rgba(210,174,99,.25), 0 6px 18px rgba(0,0,0,.35); }
@media (prefers-reduced-motion: no-preference) { .btn { transition: transform .12s ease, box-shadow .12s ease, border-color .12s ease; } .btn:hover { transform: translateY(-1px); } }
.btn.fix { background: linear-gradient(180deg, #e2bf72, #c99f50); border-color: var(--gold2); color: var(--ink); }
.btn.fix:hover { background: linear-gradient(180deg, #f0d28e, #d8b064); }
.btn.danger { border-color: rgba(255,107,97,.6); background: linear-gradient(180deg, #34222a, #261b22); }
.btn.danger:hover { background: linear-gradient(180deg, #452730, #321d25); border-color: var(--red); }
.btn.danger::before { background: var(--red); }
.btn[aria-disabled='true'] { opacity: .62; cursor: not-allowed; transform: none; box-shadow: none; }
.btn[aria-disabled='true']:not([aria-busy='true'])::after { content: ''; flex: none; width: 14px; height: 14px; background: currentColor; -webkit-mask: var(--i-lock) center / contain no-repeat; mask: var(--i-lock) center / contain no-repeat; }
.btn[aria-busy='true'] { cursor: progress; }
.btn[aria-disabled='true'].fix { background: var(--panel2); color: var(--muted); border-color: #44475e; }

/* the tooltip: one box, shown on hover and on keyboard focus; the 'Right now' part says why a button is locked */
.tip { position: fixed; z-index: 50; left: 0; top: 0; width: max-content; max-width: min(340px, calc(100vw - 16px)); padding: 10px 13px; border-radius: 10px;
  background: #f7f2e4; color: #17141c; font-size: 13.5px; line-height: 1.45; border: 1px solid #cdb67c; box-shadow: 0 12px 32px rgba(0,0,0,.55); white-space: pre-line; overflow-wrap: anywhere;
  pointer-events: none; }
.tip[hidden] { display: none; }
.tip::after { content: ''; position: absolute; left: var(--ax, 50%); width: 10px; height: 10px; margin-left: -5px; background: #f7f2e4; border: 1px solid #cdb67c; transform: rotate(45deg); }
.tip[data-side='below']::after { top: -6px; border-right: 0; border-bottom: 0; }
.tip[data-side='above']::after { bottom: -6px; border-left: 0; border-top: 0; }
.tip-now { display: block; margin-top: 7px; padding-top: 7px; border-top: 1px solid #ddcda2; color: #7a2900; font-weight: 650; }
.tip-now[hidden] { display: none; }
@media (prefers-reduced-motion: no-preference) { .tip { animation: tipin .12s ease-out; } }
@keyframes tipin { from { opacity: 0; } to { opacity: 1; } }

.hint-h { margin: 16px 0 6px; font-size: 14px; font-weight: 650; color: var(--muted); display: flex; align-items: center; gap: 8px; }
.hint-h .sico { width: 16px; height: 16px; }
.hint { margin: 0; padding: 12px 16px; border-radius: 12px; background: var(--panel); border: 1px dashed #464a63; color: var(--text); white-space: pre-wrap; overflow-wrap: anywhere; }
.tools { display: flex; flex-wrap: wrap; gap: 10px; }
.banner .tools { margin-top: 12px; }
.toast { min-height: 1.5em; margin: 12px 0 0; color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.toast.ok { color: var(--green); } .toast.warn { color: var(--amber); } .toast.bad { color: var(--red); }

details { margin-top: 18px; }
summary { display: flex; align-items: center; gap: 10px; min-height: 52px; cursor: pointer; padding: 12px 16px; font-weight: 650; color: var(--text); list-style: none; border-radius: 14px; }
summary::-webkit-details-marker { display: none; }
summary::after { content: ''; margin-left: auto; flex: none; width: 9px; height: 9px; border-right: 2px solid var(--muted); border-bottom: 2px solid var(--muted); transform: rotate(45deg); }
details[open] > summary::after { transform: rotate(-135deg); }
summary:hover { background: rgba(255,255,255,.03); }
summary:hover::after { border-color: var(--gold2); }
.sum-help { padding: 0 16px; margin: -4px 0 10px; color: var(--muted); font-size: 14px; }
.logfile { padding: 0 16px; margin: 0 0 6px; font-size: 12px; color: var(--muted); overflow-wrap: anywhere; }
pre.log { margin: 0; padding: 12px 16px; max-height: 340px; overflow: auto; border-top: 1px solid var(--line); font: 12.5px/1.45 Consolas, 'Cascadia Mono', ui-monospace, monospace; color: #cfd3d9; white-space: pre-wrap; overflow-wrap: anywhere; background: rgba(0,0,0,.25); border-radius: 0 0 14px 14px; }

.tt { padding: 0 16px 16px; }
.tt h3 { display: flex; align-items: center; gap: 8px; font-size: 15px; color: var(--text); margin: 16px 0 4px; font-weight: 650; }
.tt h3 .sico { width: 18px; height: 18px; }
.tt-note { margin: 4px 0 8px; color: var(--muted); overflow-wrap: anywhere; }
.tt-seat { padding: 12px 0; border-top: 1px solid var(--line); }
.tt-seat:first-child { border-top: 0; }
.tt-line { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; margin-top: 8px; }
.tt-line:first-child { margin-top: 0; }
.seat-name { display: inline-flex; align-items: center; gap: 8px; }
.seat-name::before { content: ''; width: 14px; height: 14px; border-radius: 50%; background: var(--grey); box-shadow: 0 0 0 2px rgba(0,0,0,.45), 0 0 8px rgba(255,255,255,.12); }
.seat-name[data-color='White']::before { background: #f0f0f0; } .seat-name[data-color='Brown']::before { background: #8a4a22; }
.seat-name[data-color='Red']::before { background: #da1918; } .seat-name[data-color='Orange']::before { background: #f4641d; }
.seat-name[data-color='Yellow']::before { background: #e7e52c; } .seat-name[data-color='Green']::before { background: #31b32b; }
.seat-name[data-color='Teal']::before { background: #21b19b; } .seat-name[data-color='Blue']::before { background: #1f87ff; }
.seat-name[data-color='Purple']::before { background: #a020f0; } .seat-name[data-color='Pink']::before { background: #f570ce; }
.tt-status { color: var(--muted); overflow-wrap: anywhere; }
.tt-list { display: grid; gap: 8px; margin-top: 8px; }
.tt-list[hidden] { display: none; }
.tt select, .tt input[type='text'], .tt input[type='password'], .tt input[type='number'], .tt textarea { font: inherit; font-size: 14.5px; min-height: 42px; color: var(--text); background: var(--panel2); border: 1px solid #44475e; border-radius: 10px; padding: 7px 11px; max-width: 100%; }
.tt select:hover, .tt input:hover, .tt textarea:hover { border-color: var(--gold); }
.tt input[type='file'] { font: inherit; font-size: 14px; color: var(--muted); max-width: 100%; }
.tt textarea { width: 100%; font: 13px/1.45 Consolas, 'Cascadia Mono', ui-monospace, monospace; resize: vertical; }
.tt input[type='number'] { width: 6.5em; }
.tt label { display: inline-flex; align-items: center; gap: 8px; }
.switch { min-height: 44px; padding: 4px 0; cursor: pointer; font-weight: 600; }
.switch input { width: 20px; height: 20px; accent-color: var(--gold); }
#tt-dbg .tools { margin-top: 12px; }
.tt-help { margin-top: 10px; border: 1px dashed #464a63; border-radius: 12px; }
.tt-help > summary { min-height: 40px; padding: 8px 14px; font-size: 14px; font-weight: 600; color: var(--muted); border-radius: 12px; }
.tt-help ol, .tt-help ul { margin: 0; padding: 0 16px 10px 36px; line-height: 1.5; overflow-wrap: anywhere; }
.tt-help li + li { margin-top: 4px; }
.tt-help b { color: var(--text); }
.tt-hand { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line); }
.tt-hand h4 { margin: 0 0 4px; font-size: 14.5px; color: var(--text); font-weight: 650; }
.tt-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(12em, 1fr)); gap: 8px; margin-top: 8px; }
.tt-cards input[type='text'] { width: 100%; }

footer { margin-top: 24px; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; color: var(--muted); font-size: 12.5px; }
body.is-down .lights, body.is-down .hint, body.is-down .tools { opacity: .45; filter: grayscale(1); }

@media (max-width: 600px) {
  header.top { padding: 16px; }
  h1 { font-size: 21px; }
  .pip { width: 22px; height: 22px; }
  .light { grid-template-columns: 22px minmax(0, 1fr); }
  .light .btn { grid-column: 2; justify-self: start; margin-top: 6px; }
  .at { margin-left: 0; }
  .btn { white-space: normal; }
}
</style>
</head>
<body>
<div class='mana' id='mana' aria-hidden='true'><i class='blob w'></i><i class='blob u'></i><i class='blob b'></i><i class='blob r'></i><i class='blob g'></i></div>
<a class='skip' href='#lights'>Skip to the lights</a>
<div class='wrap'>
<header class='top card'>
  <div class='brand'>
    <svg width='40' height='40' viewBox='0 0 16 16' aria-hidden='true' focusable='false'><rect x='2.5' y='0.5' width='10' height='14' rx='1.8' fill='#26292e' stroke='#e1e1e1' stroke-width='0.9'/><circle id='logo-dot' cx='11.2' cy='11.2' r='4.2' fill='#7d8590' stroke='#fff' stroke-width='0.9'/></svg>
    <div>
      <h1>MTG <span class='shimmer'>Companion</span></h1>
      <p class='tagline'>Runs the rules engine for your Magic table in Tabletop Simulator.</p>
      <p class='phase' id='phase'>Connecting…</p>
    </div>
  </div>
  <div class='head-right'>
    <div class='pips' aria-hidden='true'>
      <svg class='pip' viewBox='0 0 20 20' focusable='false'><circle cx='10' cy='10' r='9.5' fill='#f2e9cc'/><g fill='none' stroke='#4a3f22' stroke-width='1.6' stroke-linecap='round'><circle cx='10' cy='10' r='3'/><path d='M10 2.9v2M10 15.1v2M2.9 10h2M15.1 10h2M5 5l1.4 1.4M13.6 13.6L15 15M5 15l1.4-1.4M13.6 6.4L15 5'/></g></svg>
      <svg class='pip' viewBox='0 0 20 20' focusable='false'><circle cx='10' cy='10' r='9.5' fill='#4f95e0'/><path d='M10 4.2c2.2 3.2 4 5.3 4 7.6a4 4 0 0 1-8 0c0-2.3 1.8-4.4 4-7.6z' fill='#0d2342'/></svg>
      <svg class='pip' viewBox='0 0 20 20' focusable='false'><circle cx='10' cy='10' r='9.5' fill='#a99bb0'/><path d='M12.6 4.4a5.8 5.8 0 1 0 3 9.9a4.7 4.7 0 1 1-3-9.9z' fill='#1b1420'/></svg>
      <svg class='pip' viewBox='0 0 20 20' focusable='false'><circle cx='10' cy='10' r='9.5' fill='#e3664d'/><path d='M11.2 3.6L6.2 11h3.3l-1 5.4 5.3-7.6h-3.3z' fill='#3a0d06'/></svg>
      <svg class='pip' viewBox='0 0 20 20' focusable='false'><circle cx='10' cy='10' r='9.5' fill='#55b06c'/><path d='M5.2 14.8C5.2 8.3 9.3 5 15 5c0 6-3.6 9.8-9.8 9.8z' fill='#0f2d16'/><path d='M6 14l5.6-5.6' stroke='#55b06c' stroke-width='1.2' stroke-linecap='round'/></svg>
    </div>
    <div class='pill grey' id='overall' role='status' aria-live='polite' aria-atomic='true'><span class='dot' aria-hidden='true'></span><span id='overall-text'>Connecting…</span></div>
  </div>
</header>
<main id='main'>
  <div class='banner down' id='down' role='alert' hidden><strong>Companion not running</strong>Start MTG Companion.exe again. This page reconnects by itself.</div>
  <div class='banner warn' id='conn' role='status' aria-live='polite' hidden><strong id='conn-title'>Companion busy, retrying</strong><span id='conn-text'></span></div>
  <div class='banner down' id='pageerr' role='alert' hidden><strong>This page hit an error</strong><span id='pageerr-text'></span></div>
  <div class='banner game' id='game' role='status' aria-live='polite' hidden><strong id='game-title'>Game in progress</strong><span id='game-text'></span></div>
  <div class='banner info' id='observe' hidden>Observe only: this copy reads the lights and changes nothing.</div>
  <div class='banner update' id='update' hidden><strong id='update-title'>Update</strong><span id='update-text'></span><div class='tools' id='update-actions'></div></div>

  <div class='cols'>
  <section class='col'>
  <h2 id='lights-h'><span class='h-ico' data-icon='steps' aria-hidden='true'></span>Start steps</h2>
  <p class='help'>The companion checks these in order; a green light means that part is ready. A light that needs you gets a button.</p>
  <ul class='legend' aria-label='What the colours mean'>
    <li class='green'><span class='dot' aria-hidden='true'></span>OK: ready</li>
    <li class='busy'><span class='dot' aria-hidden='true'></span>Working</li>
    <li class='amber'><span class='dot' aria-hidden='true'></span>Check: look at it</li>
    <li class='red'><span class='dot' aria-hidden='true'></span>Problem: needs you</li>
    <li class='grey'><span class='dot' aria-hidden='true'></span>Not checked or stopped</li>
  </ul>
  <ol class='lights card' id='lights' aria-labelledby='lights-h'></ol>

  <p class='hint-h' aria-hidden='true'><span class='sico' data-icon='spark'></span>What to do next</p>
  <p class='hint' id='hint'></p>

  <details id='logbox' class='card'>
    <summary id='logbox-sum'><span class='sum-ico' data-icon='log' aria-hidden='true'></span><span>Log: the last lines of companion.log</span></summary>
    <p class='logfile' id='logfile'></p>
    <pre class='log' id='log' tabindex='0' aria-label='Log tail'>(empty)</pre>
  </details>
  </section>

  <section class='col'>
  <h2 id='tools-h'><span class='h-ico' data-icon='bolt' aria-hidden='true'></span>Actions</h2>
  <p class='help'>Controls for the engine on this PC. Hover over a button, or tab to it, to see what it does and when it is locked.</p>
  <div class='card pad'>
  <div class='tools' id='tools' role='group' aria-labelledby='tools-h'></div>
  <p class='toast' id='toast' role='status' aria-live='polite'></p>
  </div>

  <details id='srvbox' class='card' hidden>
    <summary id='srvbox-sum'><span class='sum-ico' data-icon='bolt' aria-hidden='true'></span><span>Own server: use the host’s engine</span></summary>
    <p class='sum-help'>The engine (relay and Forge room) can run on the host’s computer instead of this one: this companion then connects to it over the network and needs no Docker here.</p>
    <div class='tt'>
      <p class='tt-note' id='srv-state' role='status'></p>
      <div class='tt-line'>
        <label id='srv-host-label'>Server <input type='text' id='srv-host' autocomplete='off' spellcheck='false' placeholder='mtg.example.org or 100.64.0.5:9443'></label>
        <label id='srv-key-label'>Key <input type='password' id='srv-key' autocomplete='off' spellcheck='false' placeholder='The host’s server key'></label>
        <label class='switch' id='srv-secure-label'><input type='checkbox' id='srv-secure'> Secure (wss://)</label>
      </div>
      <div class='tools'>
        <button type='button' class='btn' id='srv-save' data-icon='check'>Use this server</button>
        <button type='button' class='btn' id='srv-local' data-icon='stop'>Use this computer</button>
      </div>
      <p class='tt-note'>The host gives you the address and the key (its MANABREW_SERVER_KEY). The key stays in server.json in this package’s folder: never share that file or post the key in a chat. The host’s firewall must let this computer reach the relay’s port (9443 unless the host changed it). Use this computer goes back to the engine in Docker here.</p>
      <p class='toast' id='srv-toast' role='status' aria-live='polite'></p>
    </div>
  </details>

  <details id='tablebox' class='card'>
    <summary id='tablebox-sum'><span class='sum-ico' data-icon='spark' aria-hidden='true'></span><span>Table tools: AI seats, debug tools and GIF frames</span></summary>
    <p class='sum-help'>Set who plays an empty seat, change the running game for testing, or give the table its GIPHY key. The bridge is asked only while this is open.</p>
    <div class='tt'>
      <p class='tt-note' id='tt-state'>Open to ask the bridge.</p>
      <h3><span class='sico' data-icon='dice' aria-hidden='true'></span>AI seats</h3>
      <p class='tt-note'>Who plays an empty seat in every game, while nobody sits there. A harmless bot keeps its hand, passes and never attacks or blocks; a Forge AI is a real opponent. The deck: one of the engine’s, or a pasted deck list (the commander under a Commander line, or marked *CMDR*), or a file.</p>
      <div id='tt-seats'></div>
      <h3><span class='sico' data-icon='wrench' aria-hidden='true'></span>Debug tools</h3>
      <label class='switch' id='tt-debug-label'><input type='checkbox' id='tt-debug'> Debug tools on (the table is told)</label>
      <p class='tt-note' id='tt-debug-note'></p>
      <div id='tt-dbg' hidden>
        <div class='tt-line'>
          <label id='tt-player-label'>Player <select id='tt-player'></select></label>
          <label id='tt-n-label'>Number <input type='number' id='tt-n' min='0' max='999' value='1'></label>
          <label id='tt-mana-label'>Mana <select id='tt-mana'><option value='W'>W white</option><option value='U'>U blue</option><option value='B'>B black</option><option value='R'>R red</option><option value='G'>G green</option><option value='C'>C colourless</option></select></label>
          <label id='tt-name-label'>Card <input type='text' id='tt-name' placeholder='Card or token name' autocomplete='off'></label>
        </div>
        <div class='tools' id='tt-tools'>
          <button type='button' class='btn' id='tt-mana-btn' data-icon='drop'>Add mana</button>
          <button type='button' class='btn' id='tt-hand-btn' data-icon='hand'>Add to hand</button>
          <button type='button' class='btn' id='tt-battlefield-btn' data-icon='field'>Put on battlefield</button>
          <button type='button' class='btn' id='tt-life-btn' data-icon='heart'>Set life</button>
          <button type='button' class='btn' id='tt-untap-btn' data-icon='untap'>Untap all</button>
          <button type='button' class='btn' id='tt-draw-btn' data-icon='draw'>Draw</button>
          <button type='button' class='btn' id='tt-mill-btn' data-icon='mill'>Mill</button>
        </div>
        <p class='tt-note'>Add mana: Number of the Mana colour, until the end of the turn. Set life: to Number. Draw and Mill: Number cards, drawn or milled by the engine itself, so its triggers fire as in play.</p>
        <div class='tt-hand' id='tt-hand'>
          <h4>Starting hand</h4>
          <p class='tt-note'>For your next game against the AI (refused with another person in it): up to 7 cards, the rest dealt at random from your deck. A named card you are dealt stays; any other is added to the game (one your deck has comes as an extra copy), and a dealt card goes under your library for it. The engine deals the opening hand itself, so these come at your first priority in turn 1, not at the keep-or-mulligan question: the dealt hand is kept by itself.</p>
          <div class='tt-line'><label id='tt-hand-color-label'>Seat <select id='tt-hand-color'></select></label></div>
          <div class='tt-cards'>
            <input type='text' id='tt-hand-1' list='tt-hand-names' autocomplete='off' aria-label='Starting hand: card 1' placeholder='Card 1'>
            <input type='text' id='tt-hand-2' list='tt-hand-names' autocomplete='off' aria-label='Starting hand: card 2' placeholder='Card 2'>
            <input type='text' id='tt-hand-3' list='tt-hand-names' autocomplete='off' aria-label='Starting hand: card 3' placeholder='Card 3'>
            <input type='text' id='tt-hand-4' list='tt-hand-names' autocomplete='off' aria-label='Starting hand: card 4' placeholder='Card 4'>
            <input type='text' id='tt-hand-5' list='tt-hand-names' autocomplete='off' aria-label='Starting hand: card 5' placeholder='Card 5'>
            <input type='text' id='tt-hand-6' list='tt-hand-names' autocomplete='off' aria-label='Starting hand: card 6' placeholder='Card 6'>
            <input type='text' id='tt-hand-7' list='tt-hand-names' autocomplete='off' aria-label='Starting hand: card 7' placeholder='Card 7'>
          </div>
          <datalist id='tt-hand-names'></datalist>
          <div class='tools'>
            <button type='button' class='btn' id='tt-hand-set' data-icon='hand'>Set for next game</button>
            <button type='button' class='btn' id='tt-hand-clear' data-icon='stop'>Clear</button>
          </div>
          <p class='tt-note' id='tt-hand-note' role='status'></p>
        </div>
      </div>
      <h3><span class='sico' data-icon='spark' aria-hidden='true'></span>GIF frames</h3>
      <p class='tt-note'>Each seated player gets a picture frame on their mat that plays a GIF they pick from GIPHY (in TTS chat: mtg gif help). It needs your own GIPHY API key, free: the steps are under the box. The key stays on this PC.</p>
      <div class='tt-line'>
        <label id='tt-gif-key-label'>GIPHY key <input type='password' id='tt-gif-key' autocomplete='off' spellcheck='false' placeholder='Paste your GIPHY API key'></label>
        <button type='button' class='btn' id='tt-gif-save' data-icon='check'>Save key</button>
        <button type='button' class='btn' id='tt-gif-remove' data-icon='stop'>Remove key</button>
      </div>
      <details class='tt-help' id='tt-gif-help'>
        <summary id='tt-gif-help-sum'>Get a GIPHY key (host only, free, about 5 minutes)</summary>
        <ol>
          <li>In your browser, go to <b>developers.giphy.com</b>, open the menu and choose <b>Dashboard</b>. Sign in, or make a free GIPHY account.</li>
          <li>Click <b>Create an App</b> (some pages say <b>Create API Key</b>).</li>
          <li>Screen 1 of 2: choose <b>API</b>, not SDK. The SDK form says “SDK beta key” and asks you to accept the SDK licence: that is the wrong one, go back and pick API.</li>
          <li>Screen 2 of 2: any app name (MTG table is fine), Platform <b>Other</b>, a one-line description (GIF frames for our Tabletop Simulator table), tick the box that names the <b>GIPHY API Terms</b>, then <b>Create API Key</b>.</li>
          <li>Copy the key from your GIPHY dashboard, paste it into the GIPHY key box above and press <b>Save key</b>.</li>
        </ol>
        <ul>
          <li>Only the host needs a key. Players don’t.</li>
          <li>It’s free. A new key is a beta key: 100 searches an hour for the whole table.</li>
          <li>The key stays on this PC: never in the table save or the friend package. Don’t share it or paste it in chats.</li>
          <li>No key: the GIF frames don’t appear, and everything else works as usual.</li>
        </ul>
      </details>
      <p class='tt-note' id='tt-gif-state'></p>
      <p class='toast' id='tt-toast' role='status' aria-live='polite'></p>
    </div>
  </details>
  </section>
  </div>
</main>
<footer><span id='versions'></span><span id='updated'></span></footer>
</div>
<div class='tip' id='tip' aria-hidden='true' hidden><span id='tip-text'></span><span class='tip-now' id='tip-now' hidden></span></div>
<div id='tipdefs' hidden></div>
<script nonce='{{NONCE}}'>
// MtgPage: pure functions (status JSON to a view model, click plans, poll scheduling, headers, the reload guard, the
// tooltips' words) plus start(env), the only part that touches the DOM, fetch and timers. tests/test_companion_page.js
// runs this script in Node with a stub env. ES5 on purpose (no build step).
var MtgPage = (function () {
  'use strict';
  var NAMES = ['Docker', 'Engine images', 'Engine stack', 'Table save', 'Bridge', 'TTS'];
  var COLORS = { green: '#3fb950', amber: '#e3a008', red: '#f85149', busy: '#58a6ff', grey: '#7d8590' };
  // poll every 2.5 s (30 s in a hidden tab); abort a poll after 6 s; two misses in a row before any connection
  // banner (one slow answer isn't a stopped companion); 'busy, retrying' for the first 10 s of misses, then
  // 'not running'; a stale token reloads the page at most once per 15 s; a tooltip stays 200 ms after the pointer leaves
  var T = { poll: 2500, hidden: 30000, abort: 6000, missesShown: 2, busyFor: 10000, reloadGuard: 15000, repoll: 400, tipHide: 200 };
  var NOT_RUNNING = 'The companion isn’t running.';

  function str(x) { return x == null ? '' : String(x); }
  function stateOf(x) { return !x ? 'grey' : x.busy ? 'busy' : (x.state || 'grey'); }

  // ── tooltips: what each control does and what it can't do. The facts come from WebUi.cs (Menu, Route, Fix,
  // UpdateSection), Controller.cs (DoFix, RestartEngine, StopEverything, DoSave), Logic.cs (Fixes.LocksDuringGame)
  // and the bridge's /tools (AI seats, DEBUG_TOOLS). A button's tip ends with a 'Right now:' line saying why it can't
  // be used at this moment (the game lock, observe mode, the companion not answering, a request in flight). ──
  var NOW = 'Right now: ';
  var STEP_ICONS = ['cube', 'layers', 'gear', 'disk', 'bridge', 'dice'];
  var MENU_TIPS = {
    'start-engine': 'Start engine: runs the start steps in order: starts Docker Desktop if it isn’t running, loads the engine images (first run only), starts the rules engine (the relay and the Forge room), installs the table save, starts the bridge and opens Tabletop Simulator. Opening the companion only checks the lights; nothing starts until you press this. It never overwrites a table save you have saved over.',
    'restart-engine': 'Restart engine: stops the bridge, restarts the rules engine (the relay and the Forge room), then runs the start steps again from step 1 and starts the bridge: under a minute, and it asks first. Locked while a game is on, or while the companion can’t tell whether one is: wait for the game to end (a game that is set up or finished unlocks after mtg reset in TTS chat). After Stop everything, this (or Start engine) starts it all again. It never overwrites a table save you have saved over.',
    'stop-everything': 'Stop everything: stops the bridge and the engine containers; Docker Desktop and TTS keep running. It asks first, and during a game it warns you, because stopping ends that game for everyone. Start engine starts it all again.',
    'open-logs': 'Open logs folder: opens the folder with companion.log and the bridge’s log. It changes nothing and works at any time, even during a game.',
    'wsl-limits': 'Limit Docker’s CPU use: optional, and it asks first. It writes processors=2 and memory=8GB into the [wsl2] section of .wslconfig in your user folder (other lines are kept, and a copy of the old file is saved beside it), so the engine’s Linux VM leaves CPU for TTS; the engine thinks a little slower. It affects every WSL program on this PC and takes effect only after WSL restarts: nothing restarts now. A game doesn’t lock it.',
    'update-now': 'Update now: downloads and installs this update (it asks first). The bridge stops for about a minute while it installs. During a game it only downloads, and installs 2 minutes after the game ends.',
    'update-later': 'Later: no reminder for this update until you press Check for updates. Nothing is downloaded.',
    'update-check': 'Check for updates: asks the project’s releases whether a newer package is out. Nothing is installed until you press Update now.'
  };
  var MENU_ICONS = { 'start-engine': 'play', 'restart-engine': 'restart', 'stop-everything': 'stop', 'open-logs': 'folder', 'wsl-limits': 'cpu', 'update-now': 'download', 'update-later': 'clock', 'update-check': 'search' };
  var UPDATE_BUSY = 'an update is being checked, downloaded or installed.';
  // (by the fix id after 'fix:<row>:'; the tip starts with the button's own label)
  var FIX_TIPS = {
    'retry': 'runs the start steps again from this one (an earlier step that hasn’t finished runs first). A game doesn’t lock it.',
    'docker-start': 'starts Docker Desktop, then runs the start steps again from step 1. A game doesn’t lock it.',
    'images-load': 'loads the engine images from this package into Docker again: a few minutes, and it asks first. Locked while a game is on.',
    'stack-restart': 'starts or restarts the engine’s relay and Forge room (about 20 s, and it asks first), then carries on with the next steps. Locked while a game is on.',
    'bridge-restart': 'restarts the bridge: a few seconds, and it asks first. TTS redraws the table. Locked while a game is on.',
    'bridge-start': 'starts the bridge, then checks TTS. It is offered only when no bridge is running, so a game never locks it.',
    'tts-open': 'opens Tabletop Simulator through Steam. A game doesn’t lock it.',
    'show-program': 'another program is using the bridge’s port. This opens Task Manager so you can close that program yourself (its process number is in this light’s text); then the Bridge step runs again. The companion closes nothing for you.'
  };
  var FIX_ICONS = { 'retry': 'restart', 'docker-start': 'play', 'images-load': 'layers', 'stack-restart': 'restart', 'bridge-restart': 'restart', 'bridge-start': 'play', 'tts-open': 'open', 'show-program': 'window' };

  function fixKind(id) { var p = str(id).split(':'); return p.length === 3 ? p[2] : ''; }
  // why a button can't be used now ('' when it can)
  function nowWhy(down, busy, locked, why) { return down ? NOT_RUNNING : busy ? 'sent; waiting for the companion’s answer.' : locked ? str(why) : ''; }
  function withNow(text, why) { return why ? text + '\n' + NOW + why : text; }
  function clip(s, n) { s = str(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // the connection banner for a poll mode ('ok', 'busy', 'reconnecting' or 'down')
  function connView(mode) {
    if (mode === 'down') return { down: true, banner: false, title: '', text: '' };
    if (mode === 'busy') return { down: false, banner: true, title: 'Companion busy, retrying', text: 'It didn’t answer the last checks. This page keeps trying.' };
    if (mode === 'reconnecting') return { down: false, banner: true, title: 'Reconnecting', text: 'The companion restarted. This page reloads itself in a few seconds.' };
    return { down: false, banner: false, title: '', text: '' };
  }

  // Every button (a light's fix, the menu, the update section's actions) has this one shape:
  // { id, kind, label, locked, lockText, confirm, confirmLocked, disabled, busy, title, aria, danger, primary, tip, icon }.
  // primary: the one button to press now (Start engine while nothing is started), drawn gold like a fix.
  // b = { down, inflight }: down disables everything; an id in inflight is disabled until its request answers.
  function lightButton(a, name, b) {
    var busy = !!b.inflight[a.id], locked = !!a.locked, lockText = str(a.lockText), kind = fixKind(a.id);
    return {
      id: a.id, kind: 'fix', label: str(a.label), locked: locked, lockText: lockText, confirm: a.confirm || null, confirmLocked: false,
      disabled: locked || b.down || busy, busy: busy, title: locked ? lockText : '',
      aria: str(a.label) + ' (' + name + ')' + (locked ? '. ' + lockText : ''), danger: false, primary: false,
      tip: withNow(str(a.label) + ': ' + (FIX_TIPS[kind] || 'the companion’s fix for the ' + name + ' step.'), nowWhy(b.down, busy, locked, lockText)),
      icon: FIX_ICONS[kind] || 'wrench'
    };
  }

  function menuButton(m, b) {
    var busy = !!b.inflight[m.id], locked = !m.enabled, lockText = m.title ? String(m.title) : 'Not available now.';
    var upd = /^update-/.test(str(m.id));
    var base = MENU_TIPS[m.id] || str(m.label) + (m.title ? ': ' + str(m.title) : '');
    var extra = m.id === 'open-logs' && m.title ? '\nFolder: ' + str(m.title) : (m.id === 'update-check' || m.id === 'update-now') && m.title ? '\n' + clip(m.title, 240) : '';
    return {
      id: m.id, kind: 'menu', label: str(m.label), locked: locked, lockText: lockText, confirm: m.confirm || null, confirmLocked: !!m.confirmLocked,
      disabled: locked || b.down || busy, busy: busy, title: str(m.title),
      aria: locked ? str(m.label) + '. ' + lockText : null, danger: m.id === 'stop-everything' || !!m.danger, primary: !!m.primary,
      tip: withNow(base + extra, nowWhy(b.down, busy, locked, upd ? UPDATE_BUSY : lockText)),
      icon: MENU_ICONS[m.id] || 'bolt'
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

  // the update section (status.update: WebUi.UpdateSection, friend mode; null in home mode and observe). Its actions
  // (update-now, update-later, update-check) use the menu's shape and go through the same
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

  // ── table tools: GET/POST /api/tools, the bridge's AI seats and debug tools passed through (WebUi.Tools) ──
  var KINDS = [['off', 'None'], ['harmless', 'Harmless bot'], ['forge', 'Forge AI']];
  var LIST_CHOICE = '__list';
  // (the companion reads a request body of at most 16 KB, MiniHttp.MaxBody: measured on the body as sent, in UTF-8
  // with its JSON escapes, as 15,000 characters of list could still be over it)
  var MAX_BODY = 16384;
  function utf8Bytes(s) {
    var n = 0;
    for (var k = 0; k < s.length; k++) {
      var c = s.charCodeAt(k);
      n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c < 0xdc00 ? 4 : c >= 0xdc00 && c < 0xe000 ? 0 : 3;
    }
    return n;
  }

  // the table tools' tips (the bridge: setAiSeat, DEBUG_TOOLS, setDebugTools; observe mode refuses every change)
  var STATIC_TIPS = {
    'srvbox-sum': 'Own server: play on the engine that runs on the host’s computer (its address and key), with no Docker on this one. Shown by the Windows companion.',
    'tablebox-sum': 'Table tools: opens the AI seat setup, the debug tools and the GIF frames’ GIPHY key. The bridge is asked only while this is open, so the engine must be running. Observe mode changes nothing here.',
    'logbox-sum': 'Log: shows the last lines of companion.log here, updated by themselves. Read only; Open logs folder has the whole file.',
    'srv-host': 'Your server: the host’s computer name or IP address, with :port when its relay isn’t on 9443. No ws:// or http://.',
    'srv-key': 'The server’s key (the host’s MANABREW_SERVER_KEY). Left empty, the key already saved for the same server is kept. The page never shows a saved key.',
    'srv-secure': 'Secure: the host’s relay is behind TLS (wss://). Leave it off for a plain relay or a private network such as Tailscale.',
    'srv-save': 'Use this server: saves server.json in this package’s folder and checks the server; the bridge then plays on it. Refused during a game.',
    'srv-local': 'Use this computer: removes server.json; the engine runs in Docker on this computer again. Refused during a game.',
    'tt-gif-key': 'Your GIPHY API key (free at developers.giphy.com). Saved in a file in your user folder on this PC only: never in the table save, the table script or a package, and sent only to this PC’s bridge and, with each search, to GIPHY. The bridge searches for the players, at most 100 times an hour with a new key.',
    'tt-gif-save': 'Save key: hands the key to the bridge, which keeps it on this PC and tells the table its GIF frames are on.',
    'tt-gif-remove': 'Remove key: deletes the saved key; the table’s GIF frames go away.',
    'tt-gif-help-sum': 'Get a GIPHY key: the steps on developers.giphy.com, for the host only (players need none). Choose API, not SDK.',
    'tt-debug': 'Debug tools: switches them on or off on the bridge, and the whole table is told in chat. They are off at every bridge start. Switching them off cancels a debug change still waiting for its vote.',
    'tt-player': 'Player: whom the debug tool changes. Only players still in the running game are listed.',
    'tt-n': 'Number: the mana to add (1 to 99), the life total to set (0 to 999), or the cards to draw or mill (1 to 99).',
    'tt-mana': 'Mana: the colour Add mana adds: W white, U blue, B black, R red, G green or C colourless.',
    'tt-name': 'Card: a card name the engine knows, for Add to hand and Put on battlefield (Put on battlefield also takes token names).',
    'tt-hand-color': 'Seat: whose next game the starting hand is for, and whose deck the card names are suggested from (the deck the bridge gives that seat: the one checked with mtg ready, else the engine’s default).',
    'tt-hand-set': 'Set for next game: sends the cards typed above to the bridge, which tells the table. The next game of that seat takes it, against the AI only: a game with another person in it drops it, said in chat. Empty boxes are dealt at random from the deck.',
    'tt-hand-clear': 'Clear: takes the waiting starting hand away, so the next game deals as usual. Switching debug tools off clears it too.'
  };
  var HAND_CARD_TIP = 'Starting hand card: a card name the engine knows (the list suggests your deck’s cards; any card is allowed). One card per box; leave a box empty and that card is dealt at random from the deck.';
  var DEBUG_TIPS = {
    mana: 'Add mana: adds Number mana of the Mana colour to the player’s pool, until the end of the turn.',
    hand: 'Add to hand: puts the card named in Card into the player’s hand.',
    battlefield: 'Put on battlefield: puts the card or token named in Card onto the player’s battlefield.',
    life: 'Set life: sets the player’s life to Number (0 to 999).',
    untap: 'Untap all: untaps everything the player controls. Refused when nothing is tapped.',
    draw: 'Draw: the engine makes the player draw Number cards (1 to 99), so triggers fire as in play. Drawing from an empty library loses the game.',
    mill: 'Mill: the engine mills Number cards (1 to 99) from the player’s library, so triggers fire as in play. Refused when the library is empty.'
  };
  var DEBUG_VOTE = ' Each change pauses the game as a manual fix, and the other players vote on it.';
  // a debug tool button's tip for the section's view (toolsView, or null before the bridge was asked)
  function debugTip(id, v, busy) {
    var why = !v ? 'the bridge hasn’t been asked yet: open Table tools.' : !v.ok ? v.state : !v.debug.usable ? v.debug.note : busy ? 'waiting for the bridge’s answer.' : '';
    return withNow((DEBUG_TIPS[id] || id) + DEBUG_VOTE, why);
  }
  function debugSwitchTip(v) { return withNow(STATIC_TIPS['tt-debug'], v && !v.ok ? v.state : ''); }
  // one AI seat row's tips
  function seatTips(c) {
    return {
      kind: c + ': who plays this seat in every game while nobody sits there. None: Start’s AI count decides. Harmless bot: keeps its hand, passes and never attacks or blocks (for testing). Forge AI: a real opponent. A person who sits at ' + c + ' plays it as usual. Press Set to send it.',
      deck: c + ': the AI’s deck. Pick one of the engine’s decks, or Deck list or file… to paste your own. A Forge AI needs one; a Harmless bot with none picked plays a lands-only deck.',
      set: 'Set ' + c + ': sends this choice to the bridge, which tells the table in chat. It applies from the next game, not the one running. Refused when it isn’t complete (no deck for a Forge AI, an empty list) or the list is over 16 KB.',
      list: c + ': paste a deck list, one card per line (1 Sol Ring). Put the commander under a Commander line or mark it *CMDR*; Sideboard and Maybeboard parts aren’t played. 16 KB at most.',
      name: c + ': an optional name for the pasted deck. Picking a file fills it with the file’s name.',
      file: c + ': reads a .txt, .dek or .dck deck file from this computer into the box above. Nothing is sent until you press Set.'
    };
  }

  // GET /api/tools (or null, or a refusal) -> what the section shows
  function toolsView(t) {
    if (!t || typeof t !== 'object' || !t.seats) {
      return { ok: false, state: str(t && t.message) || 'The bridge isn’t answering: start the engine first.', seats: [], presets: [], debug: { on: false, usable: false, players: [], note: '', tools: [] }, gifs: { set: false, text: '' }, hand: handView(null) };
    }
    var seats = t.seats.map(function (s) {
      var ai = s.ai || null;
      var status = ai ? str(ai.kindLabel) + ', playing ' + str(ai.deckName) : 'No AI set: Start’s AI count decides.';
      if (s.person) status = 'A person plays it this game' + (ai ? ' (' + str(ai.kindLabel) + ' set for when it’s empty)' : '') + '.';
      return { color: str(s.color), kind: ai ? str(ai.kind) : 'off', deck: ai ? (ai.source === 'list' ? LIST_CHOICE : str(ai.source)) : '', status: status };
    });
    var d = t.debug || {};
    var note = !d.on ? 'Off. Switch them on to change the running game.' : !d.game ? 'On. No table game is running.'
      : d.fix ? 'On. A manual fix is under way: wait for it to end.' : 'On. Each change pauses the game as a manual fix, and the other players vote on it.';
    return {
      ok: true, state: 'Read from the bridge. An AI seat applies from the next game.', seats: seats, presets: (t.presets || []).map(str),
      debug: { on: !!d.on, usable: !!(d.on && d.game && !d.fix), players: (d.players || []).map(function (p) { return { color: str(p.color), name: str(p.name) }; }), note: note,
        tools: (Array.isArray(t.tools) ? t.tools : []).map(str) },
      gifs: gifsView(t.gifs),
      hand: handView(t.hand)
    };
  }
  // the bridge's GIF search state (never the key itself: whether one is set, its last four) -> the section's line
  function gifsView(g) {
    if (!g || typeof g !== 'object' || !g.giphy || typeof g.giphy !== 'object') return { set: false, text: 'This bridge has no GIF frames yet: restart the engine to run the new one.' };
    if (!g.giphy.set) return { set: false, text: 'No GIPHY key saved: the table has no GIF frames.' };
    var used = Number(g.used) || 0, limit = Number(g.limit) || 0, rest = Number(g.restingMin) || 0;
    return { set: true, text: 'A GIPHY key ending in ' + str(g.giphy.ends) + ' is saved on this PC: the table’s GIF frames are on. Searches this hour: ' + used + (limit ? ' of ' + limit : '') + (rest ? ', resting ' + rest + ' min' : '') + '.' };
  }
  // the status JSON's server part (WebUi.ServerSection) -> what the Own server box shows; a companion that sends none
  // (the Linux/Mac one) hides the box
  function serverView(s) {
    if (!s || typeof s !== 'object' || !s.mode) return { show: false, open: false, text: '', host: '', secure: false, fixed: false, mode: '' };
    var fixed = !!s.fixed, tail = fixed ? ' (set by --server for this run: start the companion without it to change it here)' : '';
    if (s.mode === 'server') {
      var at = str(s.host) + ':' + str(s.port);
      return { show: true, open: true, mode: 'server', fixed: fixed, host: Number(s.port) === 9443 ? str(s.host) : at, secure: !!s.secure,
        text: 'This companion uses your server ' + at + (s.secure ? ' (secure)' : '') + ', with a key' + (s.keyEnds ? ' ending in ' + str(s.keyEnds) : '') + '. The light named Your server says whether it answers.' + tail };
    }
    if (s.mode === 'problem') return { show: true, open: true, mode: 'problem', fixed: fixed, host: '', secure: false, text: 'Your server setting has a problem: ' + str(s.problem) + tail };
    return { show: true, open: false, mode: 'local', fixed: fixed, host: '', secure: false, text: 'This companion runs the engine in Docker on this computer.' };
  }
  // Use this server -> the POST body, or { error }
  function serverRequest(host, key, secure) {
    var h = str(host).trim();
    if (!h) return { error: 'Type your server’s address: its name or IP, with :port if it isn’t 9443.' };
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) return { error: 'Type the address without ws:// or http:// (the port goes after a colon).' };
    if (/\s/.test(h)) return { error: 'The address has a space in it.' };
    return { host: h, key: str(key).trim(), secure: !!secure };
  }

  // Save key / Remove key -> the POST body, or { error }
  function gifKeyRequest(key, remove) {
    if (remove) return { kind: 'gif-key', provider: 'giphy', key: '' };
    var k = str(key).trim();
    if (!k) return { error: 'Paste your GIPHY key first (developers.giphy.com).' };
    if (!/^[A-Za-z0-9]{16,64}$/.test(k)) return { error: 'That doesn’t look like a GIPHY key: letters and digits only, as GIPHY shows it.' };
    return { kind: 'gif-key', provider: 'giphy', key: k };
  }

  // the bridge's Starting hand part of GET /tools (none from a bridge before it) -> { known, max, seats }
  function handView(h) {
    var list = h && Array.isArray(h.seats) ? h.seats : [];
    return { known: list.length > 0, max: h && h.max > 0 ? Number(h.max) : 7, seats: list.map(function (s) {
      return { color: str(s.color), deck: str(s.deck), source: str(s.source), cards: (Array.isArray(s.cards) ? s.cards : []).map(str),
        waiting: Array.isArray(s.waiting) ? s.waiting.map(str) : null, added: (Array.isArray(s.added) ? s.added : []).map(str) };
    }) };
  }
  // one seat's line under the box: its deck, and what is waiting for its next game
  function handNote(s, max) {
    if (!s) return 'Pick a seat.';
    var deck = !s.deck ? s.color + '’s deck can’t be read now: whether the cards are in it is said when the game starts.'
      : s.color + ' plays ' + s.deck + (s.source === 'table' ? ' (the deck checked on the table).' : s.source === 'preset' ? ' (chosen with mtg deck).' : ' (the engine’s default deck: mtg ready reads the one on your table).');
    if (!s.waiting) return deck + ' Nothing waiting: the next game deals as usual.';
    var rest = max - s.waiting.length;
    return deck + ' Waiting for the next game: ' + s.waiting.join(', ') + (rest > 0 ? ', and ' + rest + ' dealt at random.' : '.')
      + (s.added.length ? ' Not in the deck, so added: ' + s.added.join(', ') + '.' : '');
  }
  // Set for next game -> the POST body, or { error }
  function handRequest(color, values) {
    if (!color) return { error: 'Pick a seat.' };
    var names = (values || []).map(function (v) { return str(v).trim(); }).filter(function (v) { return v; });
    if (!names.length) return { error: 'Type at least one card name (or press Clear).' };
    return { kind: 'hand', color: color, names: names };
  }

  // one AI seat's Set -> the POST body, or { error }
  function seatRequest(color, kind, deck, list, name) {
    if (kind === 'off') return { kind: 'ai-seat', color: color, seat: 'off' };
    if (kind !== 'harmless' && kind !== 'forge') return { error: 'Pick who plays it.' };
    var b = { kind: 'ai-seat', color: color, seat: kind };
    if (deck === LIST_CHOICE) {
      if (!str(list).trim()) return { error: 'Paste a deck list, or pick a file, first.' };
      b.list = str(list);
      if (str(name).trim()) b.name = str(name).trim();
      if (utf8Bytes(JSON.stringify(b)) > MAX_BODY) return { error: 'That deck list is too long: the page can send 16 KB at most.' };
    } else if (deck) b.preset = deck;
    else if (kind === 'forge') return { error: 'Pick a deck for the Forge AI.' };
    return b;
  }

  // a debug tool's button -> the POST body, or { error }
  function debugRequest(tool, color, n, name, mana) {
    if (!color) return { error: 'Pick a player.' };
    var b = { kind: 'debug', tool: tool, color: color };
    if (tool === 'mana' || tool === 'life' || tool === 'draw' || tool === 'mill') {
      var k = Number(n);
      if (str(n).trim() === '' || isNaN(k) || k !== Math.floor(k)) return { error: 'Type a whole number in Number.' };
      b.n = k;
    }
    if (tool === 'mana') b.mana = str(mana);
    if (tool === 'hand' || tool === 'battlefield') {
      if (!str(name).trim()) return { error: 'Type a card name in Card.' };
      b.name = str(name).trim();
    }
    return b;
  }

  // env: { document, fetch, setTimeout, clearTimeout, now, hidden, confirm, reload, storage: { get, set },
  //        onVisible, AbortController, readFile (file, done(text)) }
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

    // ── tooltips: one floating #tip (aria-hidden), shown on hover and on keyboard focus, closed by Escape, blur or a
    // scroll. Clicks go through it (pointer-events: none), so it never covers the next control's click. Each control's
    // words also sit in a hidden span under #tipdefs that the control names in aria-describedby, so a screen reader
    // reads them; data-tip holds the same words. ──
    var tips = { seq: 0, shown: null, timer: null };
    function tip(e, text, hoverEl) {
      if (!e) return;
      text = str(text);
      if (!e.mtgTip) {
        var d = el('span', null); d.id = 'tipd-' + (++tips.seq);
        $('tipdefs').appendChild(d);
        e.mtgTip = d;
        e.setAttribute('aria-describedby', d.id);
        var h = hoverEl || e;
        h.addEventListener('mouseenter', function () { tipShow(e); });
        h.addEventListener('mouseleave', tipLater);
        e.addEventListener('focus', function () { tipShow(e); });
        e.addEventListener('blur', tipHide);
      }
      if (e.getAttribute('data-tip') !== text) e.setAttribute('data-tip', text);
      set(e.mtgTip, text);
      if (tips.shown === e) { if (e.hidden) tipHide(); else tipFill(e); }
    }
    function tipFill(e) {
      var text = str(e.getAttribute('data-tip')), k = text.indexOf('\n' + NOW);
      set($('tip-text'), k < 0 ? text : text.slice(0, k));
      set($('tip-now'), k < 0 ? '' : text.slice(k + 1));
      $('tip-now').hidden = k < 0;
    }
    function tipShow(e) {
      env.clearTimeout(tips.timer); tips.timer = null;
      if (!e.getAttribute('data-tip')) return;
      tips.shown = e;
      tipFill(e);
      $('tip').hidden = false;
      tipPlace($('tip'), e);
    }
    function tipLater() { env.clearTimeout(tips.timer); tips.timer = env.setTimeout(tipHide, T.tipHide); }
    function tipHide() { env.clearTimeout(tips.timer); tips.timer = null; tips.shown = null; $('tip').hidden = true; }
    // below the control, or above it when there is no room; kept inside the window (the stub DOM has no layout)
    function tipPlace(t, e) {
      var de = doc.documentElement;
      if (!e.getBoundingClientRect || !t.style || !de) return;
      var r = e.getBoundingClientRect(), vw = de.clientWidth, vh = de.clientHeight, gap = 10;
      t.style.left = '0px'; t.style.top = '0px';
      var w = t.offsetWidth, h = t.offsetHeight;
      var x = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, vw - w - 8));
      var below = r.bottom + gap + h <= vh - 8 || r.top - gap - h < 8;
      t.style.left = Math.round(x) + 'px';
      t.style.top = Math.round(below ? r.bottom + gap : r.top - gap - h) + 'px';
      t.setAttribute('data-side', below ? 'below' : 'above');
      t.style.setProperty('--ax', Math.round(Math.max(14, Math.min(w - 14, r.left + r.width / 2 - x))) + 'px');
    }
    doc.addEventListener('keydown', function (ev) { if (ev && (ev.key === 'Escape' || ev.key === 'Esc')) tipHide(); });
    doc.addEventListener('scroll', function () { if (tips.shown) tipHide(); }, true);

    function paint(e, v) {
      e.className = 'btn' + (v.kind === 'fix' || v.primary ? ' fix' : '') + (v.danger ? ' danger' : '');
      set(e, v.label);
      e.setAttribute('aria-disabled', v.disabled ? 'true' : 'false');
      e.setAttribute('aria-busy', v.busy ? 'true' : 'false');
      if (e.getAttribute('data-icon') !== v.icon) e.setAttribute('data-icon', v.icon);
      tip(e, v.tip);
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
      var ico = el('span', 'sico'); ico.setAttribute('aria-hidden', 'true'); ico.setAttribute('data-icon', STEP_ICONS[i] || 'cube');
      var step = el('span', 'step', (i + 1) + '.'); step.setAttribute('aria-hidden', 'true');
      var r = { li: li, name: el('h3', 'name'), word: el('span', 'word'), at: el('span', 'at'), text: el('p', 'text'), view: null };
      head.appendChild(ico); head.appendChild(step); head.appendChild(r.name); head.appendChild(r.word); head.appendChild(r.at);
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
      Object.keys(map).forEach(function (k) {
        if (seen[k]) return;
        map[k].el.hidden = true;
        if (tips.shown === map[k].el) tipHide();
      });
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
        else if (tips.shown === r.btn) tipHide();
      });
      for (var k = vm.lights.length; k < st.rows.length; k++) st.rows[k].li.hidden = true;
      set($('hint'), vm.hint);
      syncButtons($('tools'), vm.menu, st.menuBtns);
      var pre = $('log'), atEnd = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 8;
      if (pre.textContent !== vm.log.text) { pre.textContent = vm.log.text; if (atEnd) pre.scrollTop = pre.scrollHeight; }
      set($('logfile'), vm.log.file);
      set($('versions'), vm.footer.versions);
      set($('updated'), vm.footer.updated);
      srvDraw(serverView(st.last && st.last.server));
    }

    // ── own server: the box follows the status poll; what was typed is never overwritten
    var srv = { mode: null, busy: false };
    function srvSay(text, kind) { var t = $('srv-toast'); t.className = 'toast' + (kind ? ' ' + kind : ''); set(t, text); }
    function srvDraw(v) {
      $('srvbox').hidden = !v.show;
      if (!v.show) return;
      set($('srv-state'), v.text);
      if (v.mode !== srv.mode) {
        // (a new mode: the box opens for a server, and its address is filled in once)
        srv.mode = v.mode;
        if (v.open) $('srvbox').open = true;
        if (v.host && !$('srv-host').value) $('srv-host').value = v.host;
        $('srv-secure').checked = v.secure;
      }
      ['srv-host', 'srv-key', 'srv-secure', 'srv-save', 'srv-local'].forEach(function (id) { $(id).disabled = v.fixed; });
    }
    function srvPost(body, onOk) {
      if (body.error) { srvSay(body.error, 'warn'); return; }
      if (srv.busy) { srvSay('Already sent; waiting for the companion.', ''); return; }
      srv.busy = true;
      srvSay('Working…', '');
      new Promise(function (ok) {
        ok(env.fetch('/api/server', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: headers(st.token, true), body: JSON.stringify(body) }));
      }).then(function (r) { return r.json(); }).then(function (res) {
        srv.busy = false;
        var a = answerPlan(res);
        srvSay(a.text, a.kind);
        if (res && res.ok === true && onOk) onOk();
        schedule(T.repoll);
      }, function () { srv.busy = false; srvSay('The companion didn’t answer.', 'bad'); });
    }
    // (the key box is emptied once it is saved: the page never shows a key back)
    $('srv-save').addEventListener('click', function () { srvPost(serverRequest($('srv-host').value, $('srv-key').value, $('srv-secure').checked), function () { $('srv-key').value = ''; }); });
    $('srv-local').addEventListener('click', function () {
      if (!env.confirm('Use the engine on this computer again? Its server.json (with the key) is removed.')) return;
      srvPost({ local: true }, function () { $('srv-host').value = ''; $('srv-key').value = ''; });
    });

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
      if (tt.open) toolsLoad(); // (while the table tools are open, they follow the status poll)
    }

    // ── table tools ── (asked only while their section is open: a closed page never calls the bridge)
    var tt = { open: false, seq: 0, rows: {}, presets: null, players: null, busy: false, handSeats: null, handCards: null, handWaiting: null, handChosen: null };
    function ttSay(text, kind) { var t = $('tt-toast'); t.className = 'toast' + (kind ? ' ' + kind : ''); set(t, text); }
    function opt(sel, value, label) { var o = el('option', null, label); o.value = value; sel.appendChild(o); return o; }
    // a select's options from [value, label] pairs, keeping the choice when it is still there
    function fillSelect(sel, pairs) {
      var was = sel.value;
      sel.textContent = '';
      pairs.forEach(function (p) { opt(sel, p[0], p[1]); });
      if (pairs.some(function (p) { return p[0] === was; })) sel.value = was;
    }
    function deckPairs(presets) { return [['', 'Deck: pick one']].concat(presets.map(function (p) { return [p, p]; }), [[LIST_CHOICE, 'Deck list or file…']]); }
    function showList(r) {
      r.deck.hidden = r.kind.value === 'off';
      r.listBox.hidden = r.kind.value === 'off' || r.deck.value !== LIST_CHOICE;
    }
    function seatRow(s, presets) {
      var r = { color: s.color }, box = el('div', 'tt-seat');
      var l1 = el('div', 'tt-line'), l2 = el('div', 'tt-line');
      var nm = el('strong', 'seat-name', s.color); nm.setAttribute('data-color', s.color);
      r.status = el('span', 'tt-status');
      l1.appendChild(nm); l1.appendChild(r.status);
      r.kind = el('select'); r.kind.setAttribute('aria-label', s.color + ': who plays it');
      KINDS.forEach(function (k) { opt(r.kind, k[0], k[1]); });
      r.kind.value = s.kind;
      r.deck = el('select'); r.deck.setAttribute('aria-label', s.color + ': deck');
      fillSelect(r.deck, deckPairs(presets));
      r.deck.value = s.deck;
      r.set = el('button', 'btn', 'Set'); r.set.type = 'button'; r.set.setAttribute('aria-label', 'Set ' + s.color); r.set.setAttribute('data-icon', 'check');
      l2.appendChild(r.kind); l2.appendChild(r.deck); l2.appendChild(r.set);
      r.listBox = el('div', 'tt-list');
      r.list = el('textarea'); r.list.rows = 7; r.list.setAttribute('aria-label', s.color + ': deck list');
      r.list.placeholder = 'Commander\n1 Neheb, the Worthy\n\nDeck\n1 Lightning Bolt\n...';
      r.name = el('input'); r.name.type = 'text'; r.name.placeholder = 'Deck name (optional)'; r.name.setAttribute('aria-label', s.color + ': deck name');
      r.file = el('input'); r.file.type = 'file'; r.file.accept = '.txt,.dek,.dck,text/plain'; r.file.setAttribute('aria-label', s.color + ': deck list file');
      r.listBox.appendChild(r.list); r.listBox.appendChild(r.name); r.listBox.appendChild(r.file);
      box.appendChild(l1); box.appendChild(l2); box.appendChild(r.listBox);
      var w = seatTips(s.color);
      tip(r.kind, w.kind); tip(r.deck, w.deck); tip(r.set, w.set); tip(r.list, w.list); tip(r.name, w.name); tip(r.file, w.file);
      r.kind.addEventListener('change', function () { showList(r); });
      r.deck.addEventListener('change', function () { showList(r); });
      r.file.addEventListener('change', function () {
        var f = r.file.files && r.file.files[0];
        if (!f || !env.readFile) return;
        env.readFile(f, function (text) { r.list.value = str(text); if (!r.name.value) r.name.value = str(f.name).replace(/\.[^.]*$/, ''); });
      });
      r.set.addEventListener('click', function () { toolsPost(seatRequest(r.color, r.kind.value, r.deck.value, r.list.value, r.name.value)); });
      showList(r);
      $('tt-seats').appendChild(box);
      return r;
    }
    function toolsDraw(v) {
      set($('tt-state'), v.state);
      var key = v.presets.join('|');
      v.seats.forEach(function (s) {
        var r = tt.rows[s.color] || (tt.rows[s.color] = seatRow(s, v.presets));
        set(r.status, s.status);
        if (tt.presets !== null && tt.presets !== key) { fillSelect(r.deck, deckPairs(v.presets)); showList(r); }
      });
      tt.presets = key;
      $('tt-debug').checked = v.debug.on;
      $('tt-debug').disabled = !v.ok;
      tip($('tt-debug'), debugSwitchTip(v), $('tt-debug-label'));
      set($('tt-debug-note'), v.debug.note);
      set($('tt-gif-state'), v.gifs.text);
      $('tt-dbg').hidden = !v.debug.on;
      var pkey = v.debug.players.map(function (p) { return p.color + ':' + p.name; }).join('|');
      if (pkey !== tt.players) { fillSelect($('tt-player'), v.debug.players.map(function (p) { return [p.color, p.name === p.color ? p.color : p.name + ' (' + p.color + ')']; })); tt.players = pkey; }
      handDraw(v);
      // (only the tools this bridge lists: one from before Draw and Mill refuses them by name)
      TOOL_IDS.forEach(function (id) {
        var b = $('tt-' + id + '-btn');
        b.hidden = v.debug.tools.indexOf(id) < 0;
        b.setAttribute('aria-disabled', v.debug.usable && !tt.busy ? 'false' : 'true');
        tip(b, debugTip(id, v, tt.busy));
      });
    }
    // the Starting hand box: the seats, the chosen seat's deck as suggestions, what is waiting (its boxes filled when that
    // changes: after Set or Clear, not while typing)
    function handDraw(v) {
      var h = v.hand, sel = $('tt-hand-color');
      $('tt-hand').hidden = !h.known;
      var skey = h.seats.map(function (s) { return s.color + ':' + s.deck; }).join('|');
      if (skey !== tt.handSeats) {
        fillSelect(sel, h.seats.map(function (s) { return [s.color, s.deck ? s.color + ' (' + s.deck + ')' : s.color]; }));
        tt.handSeats = skey;
      }
      // (the seat picked here, kept through a bridge that went away and came back; until one is picked, the seat with a
      // deck checked on the table, else one with a hand waiting, else the first)
      var mine = h.seats.filter(function (s) { return s.source === 'table'; })[0] || h.seats.filter(function (s) { return s.waiting; })[0] || h.seats[0];
      var want = tt.handChosen && h.seats.some(function (s) { return s.color === tt.handChosen; }) ? tt.handChosen : mine && mine.color;
      if (want && sel.value !== want) sel.value = want;
      var s = h.seats.filter(function (x) { return x.color === sel.value; })[0] || null;
      var ckey = s ? s.color + ':' + s.cards.join('|') : '';
      if (ckey !== tt.handCards) { fillSelect($('tt-hand-names'), (s ? s.cards : []).map(function (n) { return [n, n]; })); tt.handCards = ckey; }
      var wkey = s ? s.color + ':' + JSON.stringify(s.waiting) : '';
      // (not while the bridge is away: what was typed waits for it to come back)
      if (h.known && wkey !== tt.handWaiting) { HAND_BOXES.forEach(function (id, k) { $(id).value = s && s.waiting && s.waiting[k] || ''; }); tt.handWaiting = wkey; }
      set($('tt-hand-note'), h.known ? handNote(s, h.max) : '');
      ['tt-hand-set', 'tt-hand-clear'].forEach(function (id) {
        $(id).setAttribute('aria-disabled', v.ok && v.debug.on && !tt.busy ? 'false' : 'true');
        tip($(id), withNow(STATIC_TIPS[id], !v.ok ? v.state : !v.debug.on ? v.debug.note : tt.busy ? 'waiting for the bridge’s answer.' : ''));
      });
    }
    var HAND_BOXES = [1, 2, 3, 4, 5, 6, 7].map(function (k) { return 'tt-hand-' + k; });
    function toolsLoad() {
      var my = ++tt.seq;
      new Promise(function (ok) { ok(env.fetch('/api/tools', { headers: headers(st.token, false), cache: 'no-store', credentials: 'same-origin' })); })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (my === tt.seq) toolsDraw(tt.view = toolsView(j)); }, function () { if (my === tt.seq) toolsDraw(tt.view = toolsView(null)); })
        .then(null, showError);
    }
    // (onOk: called with the bridge's answer when it says ok)
    function toolsPost(body, onOk) {
      if (body.error) { ttSay(body.error, 'warn'); return; }
      if (tt.busy) { ttSay('Already sent; waiting for the bridge.', ''); return; }
      tt.busy = true;
      ttSay('Working…', '');
      new Promise(function (ok) {
        ok(env.fetch('/api/tools', { method: 'POST', cache: 'no-store', credentials: 'same-origin', headers: headers(st.token, true), body: JSON.stringify(body) }));
      }).then(function (r) { return r.json(); }).then(function (res) {
        tt.busy = false;
        var a = answerPlan(res);
        ttSay(a.text, a.kind);
        if (onOk && res && res.ok === true) onOk(res);
        toolsLoad();
      }, function () { tt.busy = false; ttSay('The companion didn’t answer.', 'bad'); });
    }
    var TOOL_IDS = ['mana', 'hand', 'battlefield', 'life', 'untap', 'draw', 'mill'];
    TOOL_IDS.forEach(function (id) {
      $('tt-' + id + '-btn').addEventListener('click', function () {
        if ($('tt-' + id + '-btn').getAttribute('aria-disabled') === 'true') { ttSay($('tt-debug-note').textContent || 'Not available now.', 'warn'); return; }
        toolsPost(debugRequest(id, $('tt-player').value, $('tt-n').value, $('tt-name').value, $('tt-mana').value));
      });
      tip($('tt-' + id + '-btn'), debugTip(id, null, false));
    });
    $('tt-debug').addEventListener('change', function () { toolsPost({ kind: 'debug-mode', on: !!$('tt-debug').checked }); });
    // (the key box is emptied once the bridge has the key: the page never shows a saved key back; a refused key stays
    // in the box to be corrected)
    $('tt-gif-save').addEventListener('click', function () { toolsPost(gifKeyRequest($('tt-gif-key').value, false), function () { $('tt-gif-key').value = ''; }); });
    $('tt-gif-remove').addEventListener('click', function () { toolsPost(gifKeyRequest('', true)); });
    HAND_BOXES.forEach(function (id) { tip($(id), HAND_CARD_TIP); });
    function handPress(id, body) {
      if ($(id).getAttribute('aria-disabled') === 'true') { ttSay($('tt-debug-note').textContent || 'Not available now.', 'warn'); return; }
      toolsPost(body);
    }
    $('tt-hand-set').addEventListener('click', function () { handPress('tt-hand-set', handRequest($('tt-hand-color').value, HAND_BOXES.map(function (id) { return $(id).value; }))); });
    $('tt-hand-clear').addEventListener('click', function () { handPress('tt-hand-clear', { kind: 'hand', color: $('tt-hand-color').value, clear: true }); });
    $('tt-hand-color').addEventListener('change', function () { tt.handChosen = $('tt-hand-color').value; if (tt.view) handDraw(tt.view); });
    $('tablebox').addEventListener('toggle', function () { tt.open = !!$('tablebox').open; if (tt.open) toolsLoad(); });
    // (the page's own controls: a control inside a label shows its tip when the label is hovered too)
    Object.keys(STATIC_TIPS).forEach(function (id) { tip($(id), STATIC_TIPS[id], $(id + '-label')); });

    NAMES.forEach(function (n, i) { addRow(i); });
    draw();
    env.onVisible(poll);
    poll();
    return { poll: poll, state: st, tools: tt };
  }

  return {
    T: T, NAMES: NAMES, stateOf: stateOf, connView: connView, lightButton: lightButton, menuButton: menuButton,
    lightView: lightView, gameView: gameView, updateView: updateView, viewModel: viewModel, clickPlan: clickPlan,
    answerPlan: answerPlan, afterPoll: afterPoll, reloadAllowed: reloadAllowed, headers: headers, start: start,
    toolsView: toolsView, seatRequest: seatRequest, debugRequest: debugRequest, LIST_CHOICE: LIST_CHOICE, gifKeyRequest: gifKeyRequest, serverView: serverView, serverRequest: serverRequest, gifsView: gifsView, handRequest: handRequest, handNote: handNote, handView: handView,
    debugTip: debugTip, seatTips: seatTips, STATIC_TIPS: STATIC_TIPS, NOW: NOW, manaDrift: manaDrift
  };

  // The backdrop's five blobs (W U B R G, in the page's order) for a pointer at (px, py) in a w x h window: each one
  // drifts toward the pointer by its own share of the distance, at most a quarter of the window, and grows a little
  // when the pointer is near its home. px null: every blob back home.
  function manaDrift(px, py, w, h) {
    var home = [[0, 0], [1, 0], [0.5, 0.5], [0, 1], [1, 1]], pull = [0.22, 0.26, 0.32, 0.24, 0.28], out = [];
    for (var i = 0; i < home.length; i++) {
      if (px === null || px === undefined || !(w > 0) || !(h > 0)) { out.push({ x: 0, y: 0, s: 1 }); continue; }
      var cx = home[i][0] * w, cy = home[i][1] * h;
      var x = Math.max(-w / 4, Math.min(w / 4, (px - cx) * pull[i]));
      var y = Math.max(-h / 4, Math.min(h / 4, (py - cy) * pull[i]));
      var d = Math.sqrt(Math.pow(px / w - home[i][0], 2) + Math.pow(py / h - home[i][1], 2));
      out.push({ x: Math.round(x), y: Math.round(y), s: Math.round((1 + 0.18 * Math.max(0, 1 - d)) * 100) / 100 });
    }
    return out;
  }
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
    AbortController: window.AbortController,
    readFile: function (file, done) {
      if (!window.FileReader) return;
      var fr = new window.FileReader();
      fr.onload = function () { done(fr.result); };
      fr.readAsText(file);
    }
  });
  // the backdrop follows the pointer while it moves and drifts home 600 ms after it stops (or leaves the window);
  // nothing moves for a viewer who asked for reduced motion
  (function () {
    var layer = document.getElementById('mana');
    if (!layer || !layer.children || !window.requestAnimationFrame || !window.matchMedia) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var blobs = layer.children, frame = 0, rest = 0, px = null, py = null;
    function paint() {
      frame = 0;
      var d = MtgPage.manaDrift(px, py, window.innerWidth, window.innerHeight);
      for (var i = 0; i < blobs.length && i < d.length; i++) {
        blobs[i].style.transform = 'translate3d(' + d[i].x + 'px, ' + d[i].y + 'px, 0) scale(' + d[i].s + ')';
      }
    }
    function home() { rest = 0; px = null; py = null; layer.classList.remove('moving'); if (!frame) frame = window.requestAnimationFrame(paint); }
    document.addEventListener('pointermove', function (e) {
      px = e.clientX; py = e.clientY; layer.classList.add('moving');
      if (!frame) frame = window.requestAnimationFrame(paint);
      if (rest) window.clearTimeout(rest);
      rest = window.setTimeout(home, 600);
    });
    document.documentElement.addEventListener('mouseleave', home);
  })();
}
</script>
</body>
</html>
";
    }
}
