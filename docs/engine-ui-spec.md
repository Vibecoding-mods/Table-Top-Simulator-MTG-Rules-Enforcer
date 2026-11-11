# Engine screen UI: cleanup, tabs and the ability panel (batch B)

Asked 2026-11-09/10 (docs/next-features-2026-11-09.md items 4, 6 and 7):
- "Engine UI cleaned up and brought in line with the main UI. About half the players use the main UI and half the
  engine UI."
- "It should be more organized, compact, tabs within, and should look better / look like a[rena] UI in TTS."
- "The ability for creatures and planeswalkers UI in the bottom right looks ugly and is hard to read: grey background
  with black text. I also want it to mimic the engine in features for what it can do."
- "Floating black boxes behind the UI: find what they are and remove them."
- "The Auto-resolve button's text is dim next to 'Fix...'."

The screen UI is one XML string built in Lua (`engineRenderPanels` in tools/engine-renderer.lua) and handed to
`UI.setXml`. Each seated human gets their own copy of the per-seat elements, shown only to them (`visibility`).

## 1. What is on the screen today

Per seat (`<C>` is the colour). "Top-left rows" are at x 16, y -140 (row 1) and y -178 (row 2).

| Element | What it is | Where |
|---|---|---|
| `eng_toggle_<C>` | "Engine: show/hide": opens the answer panel | top-left row 1 |
| `eng_browse_<C>` | "Graveyards / exile": the answer panel lists every graveyard and exile | top-left row 1 |
| `eng_logbtn_<C>` | "Log": shows or hides the game log | top-left row 1 |
| `eng_pace_<C>` | "Auto: on (2 s)": draws, mills and untaps held for you are done by themselves | top-left row 1 |
| `eng_set_<C>` | "Settings": opens `eng_setpanel_<C>` | top-left row 1 |
| `eng_setpanel_<C>` | My effects / My sounds / Table animations | drops under row 1 |
| `eng_autores_<C>` | "Auto-resolve: off...": opens the shared `eng_autolist` | top-left row 2 |
| `eng_fixcall_<C>` | "Fix...": asks the others to fix the board by hand (M7) | top-left row 2 |
| `eng_fixp_<C>` | the fix panel (text and Yes / Edit the board / No) | top centre |
| `eng_undo_<C>` | "Undo...": opens `eng_undolist_<C>` | top-left row 2 |
| `eng_undolist_<C>` | up to 8 restore points (`eng_undopt_<C>_<k>`) and Close | drops under row 2 |
| `eng_vote_<C>` | the rewind vote (Rewind / Keep playing) | top centre |
| `eng_panel_<C>` | the answer panel: status, title, text, search, 30 answer buttons (`eng_opt_<C>_<k>`), Done / Cancel, the four stops | middle left, draggable |
| `eng_log_<C>` | the game log, last 16 lines | top right, draggable |
| `eng_row_<C>` | the card row: up to 7 card pictures and 5 buttons | middle |
| `eng_big_<C>`, `eng_big2_<C>` | the corner buttons (Next / End turn, Done, ...) | bottom right |
| `eng_hint_<C>` | the instruction line above the corner buttons | bottom right |
| `eng_abp_<C>` | the ability panel: the card's name and 6 ability buttons (`eng_abp_<C>_<k>`) | bottom right, above the corner |
| `eng_phase_<C>`, `eng_phasebg_<C>` | whose turn and the phases | top centre |
| `eng_banner_<C>` | YOUR TURN, step banners | middle |
| `eng_result_<C>` | VICTORY / DEFEAT | middle |
| `eng_scoop_<C>`, `eng_scoopask_<C>` | Scoop and "Concede this game?" | top centre |

Shared by every seat: `eng_cover_1..3` (covers over TTS's tool bars, host only), `eng_pop` (the stack pop-up),
`eng_autolist` (the Auto-resolve choices; `visibility` = who has it open).

The table's own screen XML (`Mock MTGA 4 player`) is only the Reveal-until-type and Cascade panels. Its "main UI" is
the buttons on its objects (mats, life counters, menus, Scry): flat near-black buttons `{0.1, 0.1, 0.1}` (#1A1A1A)
with white text, `{0.16, 0.16, 0.16}` (#292929) for the second level and `{0.4, 0.4, 0.4}` (#666666) on hover. The mats
are a warm dark brown (#2F2A24, measured on a screenshot) with each player's colour as the border.

## 2. What was wrong, and why

### 2.1 The grey ability panel with black text (and the dim Auto-resolve)

Both come from one TTS behaviour: **any `setAttribute(s)` call on a Button redraws it from the attributes the
element holds itself**. Two things follow:
- **The label goes back to TTS's default dark grey (#323232)** unless that same call carries a `textColor`, and a
  `textColor` equal to the one already stored is ignored. The renderer knew half of this: `setButton` added a
  flipped white (`nextWhite`) only when the call changed the text or showed the button.
  - Auto-resolve: `engineAutoResolveDraw` sets the text (white, fine), then the colour in a second call with no
    `textColor`, so the label is redrawn dark grey on the grey button: "dim".
  - Ability panel: `engineAbPanelShow` sets the text (white), then the `tooltip` in a second call: dark label.
- **The background goes back to TTS's default (white on the default sprite: light grey)** when the colour was never
  set on the element itself. `engineXmlCompact` moves every look that two elements share into a class in
  `<Defaults>`. The 6 ability buttons always share one look, so their `color="#2f3542"` lives only in the class.
  TTS uses it when the XML is built, but a later `setAttribute` (the tooltip) redraws the button without it. The
  Auto-resolve button kept its colour because the script sets it explicitly.

So in real TTS the ability panel showed light grey buttons with dark text, while the XML says dark with white.
(The fake TTS kept attributes only as a dictionary, so no test could see it.) The label half is known (the renderer's
own comments, and the dim Auto-resolve in the 2026-11-10 screenshots); the background half is inferred from the
symptom (grey is exactly TTS's undecorated Button) and from which buttons have it, and is confirmed by the live check.
The fix covers both whatever the exact rule is.

**Fix:** every `setButton` call carries both a `color` and a `textColor`. The text colour is flipped between two values
that look the same (#FFFFFF / #FFFFFE; any colour's last hex digit ±1), so TTS never skips it. The colour is the one
the script last set, else the one written in the XML (recorded per button id when the XML is built); once it is on
the element itself, later redraws keep it. Buttons set directly with `UI.setAttribute` (Scoop) go through `setButton`. The fake TTS now
copies the behaviour (section 6), so a button drawn grey or with a dark label fails a test.

### 2.2 The floating black boxes

`eng_cover_1..3` are near-black panels (#14161C) the table puts over TTS's own tool bars while a game runs, so the
host can't press Rewind Time (asked 2026-11-02). Their sizes were measured on one 1920x1080 screen at one UI scale.
TTS moves its bars with the UI scale, the window size and the "hide tool bar" setting, but the covers stay put, so on
other screens they float as black boxes behind the engine's buttons (the 2026-11-10 release-check screenshot shows
three: two on the left edge under "Engine: show" and one left of TTS's top menu). They are removed. Rewind Time stays
reachable for the host; the engine's own Undo (vote) is what the table offers, and a Rewind Time desync is caught by
the board check.

Also black: the game log panel (#0A0C10D0, top right) showed as an empty box until something happened. It now
stays hidden while the log is empty.

## 3. The new layout

One **dock** at the top left replaces the two rows of buttons, and one **engine window** with tabs replaces the
answer panel, the Settings drop-down and the Undo drop-down. The dock moves right to x 96, clear of TTS's left tool
bar (82 px wide), now that nothing covers it.

```
 [ Choices ][ Graveyards ][ Undo ][ Settings ][ Log ]   [ Auto-resolve: off ▾ ][ Fix... ]
 ┌──────────────────────────────────────────────┐
 │ (the open tab's content)                      │
 │                                               │
 └──────────────────────────────────────────────┘
```

- The dock (`eng_dock_<C>`, a HorizontalLayout) is one row at x 96, y -140, height 30. Auto-resolve (x 468, 150
  wide) and Fix... (x 622, 64 wide) follow on the same row, apart from the tabs (they act at once or open their own
  list, they are not tabs); Auto-resolve's list opens under it (x 468, y -174).
- Clicking a tab opens the window on that tab. Clicking the open Choices tab shuts the window; clicking the open side
  tab (Graveyards, Undo, Settings) goes back to what was open before it: the answers if they were open, else the window
  shuts. A question that isn't priority closes a side tab (as Graveyards did). The open tab is drawn gold on warm
  brown, the others white on near-black (`engineOpenTab`, styled in `updatePanel`).
- The window (`eng_panel_<C>`) hangs under the dock (x 96, y -176), 430 x 600, draggable as before.
- The side tabs reuse the window's 30 answer buttons: `engineSidePrompt` builds a look-only list (mode "browse") for
  each, and `pick` answers it (`engineBrowse[C]` is the open side tab: "browse", "undo" or "settings").

| Tab | Button (id kept) | Content |
|---|---|---|
| Choices | `eng_toggle_<C>` | today's answer panel: status, the question, search, answers, Done / Cancel, the four stops (`eng_stops_<C>`). Opens by itself when a question can only be answered there (as today). |
| Graveyards | `eng_browse_<C>` | the same list, filled with every graveyard and exile (today's "Graveyards / exile"); the stops row hides |
| Undo | `eng_undo_<C>` | shown only with restore points; lists them (the old `eng_undolist_<C>` panel and its 8 buttons are gone); a pick asks the others to vote and the tab shuts |
| Settings | `eng_set_<C>` | My effects, My sounds, Table animations (greyed for anyone but the host), "Draw / mill / untap by itself" (the old `eng_pace_<C>` button "Auto: off"); the old `eng_setpanel_<C>` is gone |
| Log | `eng_logbtn_<C>` | not a tab: shows or hides the game log at the top right (it is wanted beside the other tabs) |

Unchanged: the corner buttons, hint line, card row, phase bar, banners, Scoop, the vote, the fix panel and the stack
pop-up keep their places; they take the new colours.

## 4. Theme

Taken from the table's own buttons (section 1) and Arena's accents already in use:

| Token | Colour | Used for |
|---|---|---|
| window | #161616F0 | the engine window, the ability panel, the log, lists (was #0A0C10E8, a blue-black) |
| button | #262626 | ordinary buttons and answers (was #2f3542 slate) |
| dock | #1A1A1A | dock buttons, Auto-resolve (off) and Fix, the table's own button colour (was #1e272e / #3a3f4b) |
| second | #333333 | More..., the pop-up's X, the ability panel's pager and X (was #3a3f4b) |
| tab on | #3A3022 with gold text | the open tab |
| muted | #1C1C1C with #8C9199 text | an ability that can't be used now |
| gold | #FFD27A | titles, the open tab, ability costs (as today's titles) |
| orange | #E8711A | the main corner button (unchanged) |
| navy | #2E3A59 | the second corner button, row buttons (unchanged) |
| green / red | #2E7D32 / #8E2A2A | yes / no, Auto-resolve on (unchanged) |
| text | #FFFFFF | labels |

Font: TTS's default UI font, as the table's own buttons. Sizes: dock 14, window body 13-15, titles 16-17 bold.

## 5. The ability panel

**What it lists ("mimic the engine").** Pointing at one of your cards shows every action the engine offers for it,
and every activated ability its text has, even when it can't be used now:
1. Each option of your open priority question whose card is that card: activated abilities (with their cost),
   loyalty abilities, mana abilities of creatures and artifacts ("Mana: ..."), "Untap ... (mana back)", and casting
   or playing it, including from a graveyard, exile, the command zone or the playable row ("Cast X — flashback").
   These are bright and clickable; a click does what the option does (`engineUseAbility`).
2. Each activated ability in the card's rules text (a line "cost: effect", a loyalty line "+1: ...", or a keyword
   with a cost: Equip, Crew, Fortify, Reconfigure, Level up, Outlast, Boast, Station) that no option matches. These
   are greyed, with the reason when the table can tell:

| Reason shown | When |
|---|---|
| Not your priority (waiting for X) | no question open for you and another player has priority |
| Answer the open question first | you have a question open that isn't priority |
| Tapped | the cost has {T} or {Q} and the card is tapped |
| Summoning sickness | the cost has {T}, it is a creature that came this turn and has no haste |
| Loyalty: your main phase, empty stack | a loyalty ability outside that time |
| Needs N loyalty (has L) | a minus ability the card can't pay |
| Loyalty: once each turn | a loyalty ability at the right time but not offered (one was used) |
| Only as a sorcery | the text says so and it isn't your main phase with an empty stack |
| Used while paying a cost (tap it with Q/E) | a mana ability not offered (Forge offers them while a cost is paid, not at priority); these lines go last |
| Can't be used now (its cost or a rule) | anything else |

A click on a greyed line says its reason in your chat. The bridge's own `whyNot` is still what the card's drag or
double-click says.

**When it shows.** Your permanents with any option or any activated ability in their text; cards in other zones with
at least one option; hand cards with two or more ways to play them (a modal double-faced card, an adventure, foretell).
Lands whose only abilities are mana abilities don't open it. It stays until you point at another such card, close it
(X), or the card leaves you. It follows the board: new questions and taps redraw it.

**No cap.** 6 lines a page; a seventh button "More... (1-6 of 9)" (`eng_abpg_<C>`) turns the page; a card pointed
at afresh starts on page 1. The panel's height fits its lines, 44 + 44 a line + 34 with More (an ability list of one
was a tall black box with one button). The X is `eng_abpx_<C>`.

**Code.** `engineAbList` (the lines), `engineAbWhy` (the reasons), `engineTextAbilities` / `engineTextAbility` /
`engineLoyaltyCost` (the card's text, plain finds), `engineAbPanelRows` (whether it opens), `engineAbRowLabel` (rich
text), `engineAbPanelShow` / `engineAbPanelHide` / `onMtgAbPanel`; `engineAbShown` holds what a click reads,
`engineAbPage` the page. Redrawn by `engineAbilityBoxes` (each question) and at the end of `engineUpdateCorner` (each
board).

**Look.** Window colour, the card's name in gold with a close X. Each line is one button, left-aligned: the cost in
gold bold, then the effect, white on #262626. A greyed line is #8C9199 on #1C1C1C with its reason in italics.
The whole text is the tooltip.

## 6. Size

The whole screen UI must stay under the 60,000-byte guard with four seats. Measured with tmp/ui-size.js (the fake
TTS, all four seats): before/after are in the commit messages and the report. The new elements are generated per
colour in Lua, as before. The Undo list moves inside the window; Settings likewise; the covers go (about 0.5 KB).

## 7. Tests (tests/test_table_claims.js, fake TTS tests/lua/tts-sim.lua)

The fake TTS learns the redraw behaviour of section 2.1: it knows which ids are Buttons (from the XML), keeps each
Button's own attributes, and on every `setAttribute(s)` call works out what TTS would draw: the label dark unless the
call carries a new `textColor`, the background from the element's own `color` (TTS's white when it has none).
`__sim.drawn(id)` returns "<background>|<label colour>".

Claims:
1. Tabs: each tab button opens the window on its tab and only that tab's content is active; the open tab is gold;
   clicking it again closes the window; Graveyards fills the list with graveyard cards; Undo lists the restore points
   and a pick asks for the rewind; Settings shows the four switches.
2. Ability panel: a card with 9 activated abilities lists 6 and More; More shows the next 3; a click on a line of
   page 2 uses that ability.
3. Greyed reasons: a tapped card's {T} ability, a summoning-sick creature's, a planeswalker's minus ability it can't
   pay, and "not your priority" with no question.
4. Colours: every Button the engine shows in these scenes is drawn with a dark background and a light label
   (`__sim.drawn`), including the ability panel after its tooltip is set and Auto-resolve after its colour changes.
5. No cover panels in the XML; the log panel is hidden while the log is empty.
6. Size: four seats under 60,000 bytes (the existing claim).

## 8. Live check in real TTS (the lead, after merging)

See the report: Auto-resolve's text white; the ability panel dark with white text and gold costs; greyed lines with
reasons; More paging; the five tabs; no black boxes at the left edge or left of TTS's top menu; the log hidden until
the first line.

## 9. Combat clarity (added 2026-11-11, docs/next-features-2026-11-09.md item 2)

Asked 2026-11-09: "Attack/block parts are highlighted green, and turn red when you're the one being attacked";
"attacker and defender pickers organised under tabs, so a big token board doesn't need endless scrolling; same-named
tokens (e.g. #1 to #20) sit under one tab"; "assigning a blocker to an attacker sometimes gives no confirmation.
Always confirm."

**Colours** (`ENGINE_COMBAT`, decided here: the request named no parts, so these are the screen parts that belong to
an attack or a block; the table's own glows, seen by everyone, are unchanged: green = can attack / block, red =
attacking, blue = blocking):

| Part | Attack question (your attack) | Blockers question (you are attacked) |
|---|---|---|
| a line in the window | #1F4D2B, #2E9E4F once picked (was red #7a2323 / #e84118) | #5E1E1E, #C62828 once picked (was blue) |
| All attack / No attacks lines | All attack #2E9E4F, No attacks navy #2E3A59 (were red / blue) | |
| the corner | the button that attacks ("All attack", "Attack (n)") #2E9E4F; "No attacks" navy | Done #C62828 |
| COMBAT in the phase bar | #7CFC9A on your own turn | #FF6B6B while a creature attacks you or your planeswalker (the board's `atk` / `atkT`), or your blockers question is open; else gold as every step |

Any other question gives the corner its own orange and navy back.

**Tabs** (`engineCombatGroups`, `engineCombatTabsDraw`, `onMtgCTab`; decided here). An attack or blockers question with
more than `ENGINE_CTAB_MIN` (8) creature lines and two or more names gets a row of tabs in the window under the search
box (`eng_ctabs_<C>`, two rows of four buttons `eng_ctab_<C>_<k>`). One tab per name of the creature you choose with:
the attacker in an attack, the blocker in a blockers question (the start of the bridge's line, its name for the
creature without the "#3", the size, the counters and the damage, so tokens of one name and two sizes, or one with a
counter on it, share a tab). A tab reads "Spirit Token (20)", "(3/20)" once 3 of them are picked. The first tab opens with the
question; the open tab is gold on warm brown as the dock's. The list shows the open tab's lines with All attack / No
attacks above them; the answer list pages within a tab as before. More than 8 names: 7 tabs and "More tabs (1/2)",
which shows the next ones and opens the first of them. A search looks through every tab (no tab is gold then); clicking a tab ends the search.
The answer list is 258 high while the tabs show (318 without), so the window keeps its height. Smaller questions look as
before. The bridge numbers the blockers question's creatures as it does the attackers' ("Spirit Token 1/1 #3 blocks
Goblin Token 1/1 #5", `numberedLabels`): twenty identical lines couldn't be told apart.

**Block confirmations** (decided here). Why one was sometimes missing: the table drops a chat line said in the 3 s
before, so a second blocker's "Now click the attacker to block." within 3 s said nothing; and an attacker clicked
after a block was taken back did nothing at all. Now every click of a blockers question on the table says what it did,
always (`tell(..., always)`), naming the creatures as the question does:
- a blocker: "Now click the attacker for Wall of Omens 0/4 #1 to block (or click it again: no block)."; a blocker that
  had a block has it taken back at once, said as "Wall of Omens 0/4 #1's block is taken back: it won't block unless
  you click an attacker for it now.", and the attacker clicked next is its new block;
- an attacker: "Wall of Omens 0/4 #1 blocks Spirit Token 1/1 #2. Click the blocker again to change it; Done when
  finished."; an attacker with no blocker waiting: "Click one of your creatures first, then this attacker.";
- the waiting blocker again: "Wall of Omens 0/4 #1 won't block."; an attacker it can't block: says so;
- the card's right-click "Don't block with this": "Wall of Omens 0/4 #1 won't block.";
- a line picked in the window: the same "X blocks Y. Done when finished." (with "(It no longer blocks Z.)" when it
  replaced that creature's other block), or "Taken back: ..." when it was picked before.

**Tests** (tests/test_table_claims.js): the colours of the lines, the corner and the phase bar on both sides; the
tabs of a 22-line attack (20 tokens, two others), a tab's lines, a pick under a tab, a search, a small question
without tabs, nine names with More tabs, a blockers question's tabs; the block confirmations click by click.

**Live check (real TTS):** the green and red lines and corner buttons, COMBAT's colour for the attacker and the
defender, the tabs' row fitting the window (labels of 13 characters at font 12), each confirmation in the chat.
