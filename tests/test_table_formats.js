// Formats and ban lists on the table (docs/format-banlist-spec.md §6.1, §6.2, §7, test 4 of §8; tools/engine-renderer.lua
// engineSetFormat / engineFormatChat / engineFormatButtons / engineOnBanlist / engineOnBanlistNames, make-engine-copy.js's
// deck check, start and chat), on the fake TTS:
//  - the Format button (where Game mode was) cycles forward, and back on a right-click (alt_click), past a format the
//    bridge has no list for; "mtg format <name>" (host) and "mtg format" (the list);
//  - host only, for the button, the two switches and the typed commands;
//  - the Banned cards and Restricted cards switches: per format, on (enforced) by default, Restricted only where the
//    format has a restricted list; their labels, the change said to everyone and sent ("format");
//  - READY cleared by every change;
//  - engineSetupIntact with the new buttons: no redraw over 10 heals;
//  - the Banned list button: its count from the bridge's "banlist", a line to the presser (anyone), the Notebook tab
//    "Banned list" written from "banlistNames", rewritten when the list changes, found by its title;
//  - decks, start and hello carry format / banned / restricted (nothing for Casual Commander);
//  - a 60-card format drops 2HG; a format problem's deckReport is today's red FIX DECK, no Start;
//  - "mtg banlist refresh" (host) asks the bridge.
//   node tests/test_table_formats.js        (TABLE_SAVE=<save.json> to test a given save)
const fs = require("fs");
const path = require("path");
const { simulate } = require("./lua/run-sim");
const { buildSave } = require("./golden/table-run");

const save = process.env.TABLE_SAVE ? JSON.parse(fs.readFileSync(process.env.TABLE_SAVE, "utf8")) : buildSave();
const s1 = JSON.parse(fs.readFileSync(path.join(__dirname, "golden", "fixtures", "table-stream-1v1.json"), "utf8"));
let failed = 0, passed = 0;
const ok = (name, cond, why) => { if (cond) passed++; else { failed++; console.log(`FAIL ${name}${why !== undefined ? `: ${String(why).slice(0, 600)}` : ""}`); } };
const q = (lua, mark, frames) => ({ lua, mark, ...(frames != null ? { frames } : {}) });
const step = (r, mark) => r.steps.find((s) => s.step === mark) || {};
const valueOf = (r, mark) => step(r, mark).value;
const fxOf = (r, mark) => step(r, mark).fx || [];
const told = (r, mark) => fxOf(r, mark).filter((l) => /broadcast/.test(l)).join(" | ");
const msg = (t, o, mark) => ({ msg: { t, json: JSON.stringify({ t, ...o }) }, ...(mark ? { mark } : {}) });

// Lua probes (an action step whose messages are checked starts with __sent = {}: sent() then reads what it sent)
const sentLog = 'local real = engineSend __sent = {} engineSend = function(t, p) __sent[#__sent + 1] = t .. " " .. JSON.encode(p or {}) return real(t, p) end';
const sent = (mark) => q('local s = table.concat(__sent, "\\n") __sent = {} return s', mark);
// what a step sent, without the table's own "hello again" (its once-a-while ask for the game): "" for nothing
const sentOf = (r, mark) => String(valueOf(r, mark) || "").split("\n").filter((l) => l && !l.startsWith('hello {"again":true')).join("\n");
const fmt = (mark) => q('return ENGINE_FORMAT .. "|" .. ENGINE_GAME_MODE', mark);
// the tile's buttons: "click=label" each
const tile = (mark) => q('local t = {} for _, o in ipairs(getObjects()) do if o.getGMNotes() == "mtgsetup" then for _, b in ipairs(o.getButtons() or {}) do t[#t + 1] = b.click_function .. "=" .. b.label end end end return table.concat(t, ";")', mark);
const readyAll = '__sent = {} engineReadyState.Blue = "ready" engineReadyState.White = "ready" ';
const readyLeft = (mark) => q('return tostring(engineReadyState.Blue) .. "," .. tostring(engineReadyState.White)', mark);
const notebook = (mark) => q('local t = {} for _, n in ipairs(Notes.getNotebookTabs()) do t[#t + 1] = n.index .. ":" .. n.title .. "=" .. n.body end return table.concat(t, "\\n####\\n")', mark);
// the Format button's font size
const fontOf = 'local t = nil for _, o in ipairs(getObjects()) do if o.getGMNotes() == "mtgsetup" then t = o end end for _, b in ipairs(t.getButtons() or {}) do if b.click_function == "onMtgSetupMode" then return tostring(b.font_size) end end';
const btn = (r, mark, click) => { const m = String(valueOf(r, mark) || "").split(";").find((b) => b.startsWith(`${click}=`)); return m ? m.slice(click.length + 1) : null; };

const r = simulate({ save, seated: ["Blue", "White"], host: "Blue", steps: [{ lua: "setEngineMode(true)", frames: 120 },
  q(sentLog, "wrap"), fmt("at load"), tile("tile at load"),
  q('engineHello() engineSendDecks({ "Blue" }, "Blue")', "casual msgs"), sent("casual sent"),
  // the Format button: forward, back on a right-click, round the end
  q('__sent = {} onMtgSetupMode(nil, "Blue")', "click 1"), fmt("after click 1"), tile("tile commander"), sent("click 1 sent"),
  q('onMtgSetupMode(nil, "Blue")', "click 2"), fmt("after click 2"),
  q('onMtgSetupMode(nil, "Blue", true)', "alt 1"), fmt("after alt 1"),
  q('onMtgSetupMode(nil, "Blue", true)', "alt 2"), fmt("after alt 2"),
  q('onMtgSetupMode(nil, "Blue", true)', "alt 3"), fmt("after alt 3"),
  q('engineChat("mtg format  Duel  Commander", Player.Blue)', "typed name"), fmt("after typed name"),
  q('__sent = {} engineChat("mtg format casual", Player.Blue)', "typed back"), fmt("after typed back"), sent("typed back sent"),
  // the bridge has no list for Duel Commander: skipped by the button, refused typed
  msg("banlist", { format: "commander", source: "scryfall", date: "2026-11-18", counts: { banned: 83, restricted: 0 }, missing: ["duel"] }),
  q('onMtgSetupMode(nil, "Blue")', "to commander"), fmt("at commander"), tile("tile commander listed"),
  q('onMtgSetupMode(nil, "Blue")', "skip duel"), fmt("after skip duel"), q(fontOf, "font pauper"),
  q('onMtgSetupMode(nil, "Blue", true)', "alt skip duel"), fmt("after alt skip duel"),
  q('engineChat("mtg format duel commander", Player.Blue)', "typed duel"), fmt("after typed duel"),
  // host only
  q(readyAll + 'onMtgSetupMode(nil, "White")', "white clicks"), fmt("after white clicks"), sent("white sent"), readyLeft("ready after white"),
  q('engineChat("mtg format modern", Player.White)', "white types"), fmt("after white types"),
  // Modern: Banned cards on, no Restricted; the switch, READY cleared, said, sent
  q(readyAll + 'engineChat("mtg format modern", Player.Blue)', "modern"), fmt("at modern"), readyLeft("ready after modern"), sent("modern sent"), tile("tile modern"),
  q(readyAll + 'onMtgSetupBanned(nil, "White")', "white banned"), sent("white banned sent"), readyLeft("ready after white banned"),
  q(readyAll + 'onMtgSetupBanned(nil, "Blue")', "banned off"), readyLeft("ready after banned off"), sent("banned off sent"), tile("tile banned off"),
  q('__sent = {} engineChat("mtg restricted off", Player.Blue)', "restricted in modern"), sent("restricted in modern sent"),
  q('__sent = {} engineSendDecks({ "Blue" }, "Blue") engineStartSentAt = nil engineChat("mtg start ai 1", Player.Blue) engineHello()', "modern msgs"), sent("modern msgs sent"),
  // Vintage: both switches, each its own; back to Modern keeps Modern's
  q('engineStartSentAt = nil ' + readyAll + 'engineChat("mtg format vintage", Player.Blue)', "vintage"), tile("tile vintage"), sent("vintage sent"),
  q(readyAll + 'onMtgSetupRestricted(nil, "Blue")', "restricted off"), readyLeft("ready after restricted off"), sent("restricted off sent"), tile("tile restricted off"),
  q('onMtgSetupRestricted(nil, "White")', "white restricted"), tile("tile white restricted"),
  q('engineChat("mtg format duel", Player.Blue)', "duel still missing"),
  msg("banlist", { format: "vintage", source: "scryfall", date: "2026-11-18", counts: { banned: 101, restricted: 52 }, missing: [] }),
  q('engineChat("mtg format duel", Player.Blue)', "duel"), tile("tile duel"),
  q('engineChat("mtg format modern", Player.Blue)', "modern again"), tile("tile modern again"),
  // no redraw loop: 10 heals with nothing changed draw nothing
  q('return tostring(engineSetupIntact())', "intact"),
  { frames: 1220, mark: "ten heals" },
  // a format button wiped (TTS's own scripts or a reload can): the next heal draws it again
  q('local t = nil for _, o in ipairs(getObjects()) do if o.getGMNotes() == "mtgsetup" then t = o end end for i, b in ipairs(t.getButtons()) do if b.click_function == "onMtgSetupBanlist" then t.removeButton(i - 1) break end end', "wipe banlist", 130), tile("tile healed"),
  // the Banned list: the count from "banlist", a line to the presser (anyone), the Notebook tab from "banlistNames"
  q('Notes.addNotebookTab({ title = "Sideboard", body = "4 Duress" })', "own tab"),
  msg("banlist", { format: "modern", source: "scryfall", date: "2026-11-18", counts: { banned: 3, restricted: 0 } }), tile("tile counted"),
  q('__sent = {} onMtgSetupBanlist(nil, "White")', "white presses list"), sent("white list sent"),
  msg("banlistNames", { format: "modern", source: "scryfall", date: "2026-11-18", banned: ["Up the Beanstalk", "Mycosynth Lattice", "Ancient Den"], restricted: [] }),
  notebook("tab written"), tile("tile after names"),
  q('__sent = {} onMtgSetupBanlist(nil, "White")', "white presses again"), sent("white again sent"),
  msg("banlistNames", { format: "modern", source: "scryfall", date: "2026-11-19", banned: ["Up the Beanstalk", "Mycosynth Lattice", "Ancient Den", "Nadu, Winged Wisdom"], restricted: [] }, "names changed"),
  notebook("tab rewritten"), tile("tile rewritten"),
  msg("banlistNames", { format: "vintage", source: "scryfall", date: "2026-11-19", banned: ["Black Lotus"], restricted: ["Sol Ring"] }),
  notebook("other format names"),
  // typed: the list, a bad name, the switches' words, refresh
  q('engineChat("mtg format", Player.White)', "list"),
  q('engineChat("mtg format vintagee", Player.Blue)', "bad name"),
  q('__sent = {} engineChat("mtg banlist refresh", Player.White)', "white refresh"), sent("white refresh sent"),
  q('__sent = {} engineChat("mtg banlist refresh", Player.Blue)', "refresh"), sent("refresh sent"),
  // a format problem: the bridge's deckReport, as today: red FIX DECK, no Start
  q(readyAll + 'engineSetupButtons()', "both ready"), tile("tile both ready"),
  msg("deckReport", { ready: [], checked: ["Blue"] }),
  q('local mat = data.Blue.playmat local t = {} for _, b in ipairs(mat.getButtons() or {}) do t[#t + 1] = b.label end return table.concat(t, ",")', "blue mat"), tile("tile problem"),
  // 2HG in Commander, then a 60-card format: teams back to none
  q('engineChat("mtg format commander", Player.Blue) engineChat("mtg mode 2hg", Player.Blue) return tostring(ENGINE_TEAM_MODE)', "2hg"),
  q('engineChat("mtg format pioneer", Player.Blue) return tostring(ENGINE_TEAM_MODE) .. "|" .. ENGINE_GAME_MODE', "pioneer drops 2hg"),
  // in a game: the format buttons hidden
  { msg: { t: s1[0].t, json: s1[0].json } }, { msg: { t: s1[3].t, json: s1[3].json } },
  ...s1.slice(4, 12).map((m) => ({ msg: { t: m.t, json: m.json } })),
  tile("tile in game"),
] });

ok("no Lua errors", r.errors.length === 0, r.errors.join(" / "));
// load
ok("load: Casual Commander, the Format button where Game mode was, Banned list says none, no switches", valueOf(r, "at load") === "casualcommander|commander"
  && btn(r, "tile at load", "onMtgSetupMode") === "Format\nCasual Commander" && btn(r, "tile at load", "onMtgSetupBanlist") === "Banned list\nNone"
  && btn(r, "tile at load", "onMtgSetupBanned") === null && btn(r, "tile at load", "onMtgSetupRestricted") === null, valueOf(r, "tile at load"));
const casual = sentOf(r, "casual sent");
ok("Casual Commander: hello and decks carry no format, banned or restricted", /^hello \{/m.test(casual) && /^decks \{/m.test(casual) && !/"format"|"banned"|"restricted"/.test(casual), casual.slice(0, 300));
// the button
ok("Format button: a click goes to the next format, said and sent", valueOf(r, "after click 1") === "commander|commander" && /set the format: Commander \(100-card decks with a commander, 40 life; banned cards not allowed\)\. Everyone presses READY again\./.test(told(r, "click 1"))
  && /^format \{.*"banned":true.*"format":"commander".*"mode":"commander".*"restricted":true/.test(sentOf(r, "click 1 sent")), `${told(r, "click 1")} ${sentOf(r, "click 1 sent")}`);
ok("Format button: says the format", btn(r, "tile commander", "onMtgSetupMode") === "Format\nCommander", valueOf(r, "tile commander"));
ok("Format button: forward twice, then a right-click goes back", valueOf(r, "after click 2") === "duel|commander" && valueOf(r, "after alt 1") === "commander|commander" && valueOf(r, "after alt 2") === "casualcommander|commander",
  `${valueOf(r, "after click 2")} ${valueOf(r, "after alt 1")} ${valueOf(r, "after alt 2")}`);
ok("Format button: a right-click on the first format goes round to the last (Alchemy, 60-card: 20 life)", valueOf(r, "after alt 3") === "alchemy|standard", valueOf(r, "after alt 3"));
ok("mtg format <name>: by its name, capitals and spaces as typed", valueOf(r, "after typed name") === "duel|commander", valueOf(r, "after typed name"));
ok("mtg format <other name>: casual is Casual Commander", valueOf(r, "after typed back") === "casualcommander|commander" &&/^format \{.*"format":"casualcommander"/.test(sentOf(r, "typed back sent")), `${valueOf(r, "after typed back")} ${sentOf(r, "typed back sent")}`);
ok("a format the bridge has no list for: the button skips it, both ways", valueOf(r, "at commander") === "commander|commander" && valueOf(r, "after skip duel") === "paupercommander|commander" && valueOf(r, "after alt skip duel") === "commander|commander",
  `${valueOf(r, "at commander")} ${valueOf(r, "after skip duel")} ${valueOf(r, "after alt skip duel")}`);
ok("a long format name gets a smaller font (Pauper Commander: 16 letters)", Number(valueOf(r, "font pauper")) === 192, valueOf(r, "font pauper"));
ok("a format the bridge has no list for: refused typed, said why", valueOf(r, "after typed duel") === "commander|commander" && /Duel Commander needs its ban list: the bridge hasn't downloaded it yet \(mtg banlist refresh\)/.test(told(r, "typed duel")), told(r, "typed duel"));
ok("a format with a list: the Banned cards switch shows, enforced", btn(r, "tile commander listed", "onMtgSetupBanned") === "Banned cards\nNot allowed" && btn(r, "tile commander listed", "onMtgSetupRestricted") === null, valueOf(r, "tile commander listed"));
// host only
ok("host only: the Format button refused to another player, nothing changed or sent, READY kept", valueOf(r, "after white clicks") === "commander|commander" && /Only the host can change the format/.test(told(r, "white clicks"))
  && sentOf(r, "white sent") === "" && valueOf(r, "ready after white") === "ready,ready", `${told(r, "white clicks")} ${sentOf(r, "white sent")} ${valueOf(r, "ready after white")}`);
ok("host only: mtg format refused to another player", valueOf(r, "after white types") === "commander|commander" && /Only the host can change the format/.test(told(r, "white types")), told(r, "white types"));
ok("host only: the Banned cards switch refused to another player, READY kept", /Only the host can change the format/.test(told(r, "white banned")) && sentOf(r, "white banned sent") === "" && valueOf(r, "ready after white banned") === "ready,ready", told(r, "white banned"));
ok("host only: the Restricted cards switch refused to another player", /Only the host can change the format/.test(told(r, "white restricted")) && btn(r, "tile white restricted", "onMtgSetupRestricted") === "Restricted\nNormal limit", told(r, "white restricted"));
ok("host only: mtg banlist refresh refused to another player, nothing sent", /Only the host can refresh the ban lists/.test(told(r, "white refresh")) && sentOf(r, "white refresh sent") === "", told(r, "white refresh"));
// Modern and its switch
ok("READY cleared by a format change", valueOf(r, "ready after modern") === "nil,nil", valueOf(r, "ready after modern"));
ok("Modern: 60-card (20 life), Banned cards enforced, no Restricted switch", valueOf(r, "at modern") === "modern|standard" && btn(r, "tile modern", "onMtgSetupBanned") === "Banned cards\nNot allowed"
  && btn(r, "tile modern", "onMtgSetupRestricted") === null && btn(r, "tile modern", "onMtgSetupMode") === "Format\nModern", valueOf(r, "tile modern"));
ok("Banned cards switch: off, said to everyone, sent, READY cleared", btn(r, "tile banned off", "onMtgSetupBanned") === "Banned cards\nAllowed" && valueOf(r, "ready after banned off") === "nil,nil"
  && /set the format: Modern \(60\+ cards, at most 4 of a card, no commander; 20 life; banned cards allowed \(house rule\)\)\. Everyone presses READY again\./.test(told(r, "banned off"))
  && /^format \{.*"banned":false.*"format":"modern"/.test(sentOf(r, "banned off sent")), `${told(r, "banned off")} ${sentOf(r, "banned off sent")}`);
ok("mtg restricted in a format without a restricted list: said, nothing sent", /Modern has no restricted list/.test(told(r, "restricted in modern")) && sentOf(r, "restricted in modern sent") === "", told(r, "restricted in modern"));
const mm = sentOf(r, "modern msgs sent");
const line = (t) => mm.split("\n").find((l) => l.startsWith(`${t} `)) || "";
ok("Modern: decks, start and hello carry format, banned and restricted", [line("decks"), line("start"), line("hello")].every((l) => /"banned":false/.test(l) && /"format":"modern"/.test(l) && /"restricted":true/.test(l) && /"mode":"standard"/.test(l)),
  [line("decks"), line("start"), line("hello")].map((l) => l.slice(0, 160)).join(" / "));
// Vintage and Duel Commander
ok("Vintage: both switches enforced (per format: Modern's off doesn't carry)", btn(r, "tile vintage", "onMtgSetupBanned") === "Banned cards\nNot allowed" && btn(r, "tile vintage", "onMtgSetupRestricted") === "Restricted\n1 copy", valueOf(r, "tile vintage"));
ok("Restricted cards switch: off, said, sent, READY cleared", btn(r, "tile restricted off", "onMtgSetupRestricted") === "Restricted\nNormal limit" && valueOf(r, "ready after restricted off") === "nil,nil"
  && /Vintage \(.*banned cards not allowed; restricted cards at the normal limit \(house rule\)\)/.test(told(r, "restricted off"))
  && /^format \{.*"banned":true.*"format":"vintage".*"restricted":false/.test(sentOf(r, "restricted off sent")), `${told(r, "restricted off")} ${sentOf(r, "restricted off sent")}`);
ok("a switch turned off shows yellow (a house rule)", fxOf(r, "restricted off").some((l) => /createButton.*Restricted[\s\S]{0,3}Normal limit.*0\.85,0\.68,0\.12/.test(l)), fxOf(r, "restricted off").filter((l) => /Restricted/.test(l)).join(" "));
ok("the bridge's next banlist names no missing format: Duel Commander can be picked", /needs its ban list/.test(told(r, "duel still missing")) && btn(r, "tile duel", "onMtgSetupMode") === "Format\nDuel Commander", `${told(r, "duel still missing")} ${valueOf(r, "tile duel")}`);
ok("Duel Commander: the Restricted switch is 'not as commander'", btn(r, "tile duel", "onMtgSetupRestricted") === "Restricted\nNot as commander", valueOf(r, "tile duel"));
ok("back to Modern: its own switch kept (banned allowed), no Restricted", btn(r, "tile modern again", "onMtgSetupBanned") === "Banned cards\nAllowed" && btn(r, "tile modern again", "onMtgSetupRestricted") === null, valueOf(r, "tile modern again"));
// the heal
ok("engineSetupIntact: the tile with the format buttons is whole", valueOf(r, "intact") === "true", valueOf(r, "intact"));
ok("a wiped format button: drawn again at the next heal", btn(r, "tile healed", "onMtgSetupBanlist") !== null, valueOf(r, "tile healed"));
ok("no redraw loop: 10 heals draw no button", !fxOf(r, "ten heals").some((l) => /createButton|clearButtons/.test(l)), fxOf(r, "ten heals").filter((l) => /Button/.test(l)).slice(0, 4).join(" "));
// the Banned list
ok("Banned list button: the bridge's count on its label", btn(r, "tile counted", "onMtgSetupBanlist") === "Banned list\nModern: 3", valueOf(r, "tile counted"));
ok("Banned list button: anyone, a line to the presser only", fxOf(r, "white presses list").some((l) => /broadcastToColor" "White" "\[MTG\] Modern: 3 banned\. The full list is in the Notebook, tab 'Banned list' \(Scryfall, 2026-11-18\)\./.test(l))
  && !fxOf(r, "white presses list").some((l) => /broadcastToAll/.test(l)), told(r, "white presses list"));
ok("Banned list button: the Notebook has no list yet, so the bridge is asked for the names", /^banlist \{"color":"White","format":"modern"\}$/.test(sentOf(r, "white list sent")), sentOf(r, "white list sent"));
const tab1 = String(valueOf(r, "tab written"));
ok("Notebook: the tab 'Banned list' added beside the table's own, the names sorted, the source and count", /^0:Sideboard=4 Duress\n####\n1:Banned list=Modern: 3 banned \(Scryfall, 2026-11-18\)\./.test(tab1)
  && tab1.includes("Banned (3):\nAncient Den\nMycosynth Lattice\nUp the Beanstalk") && tab1.split("####").length === 2, tab1);
ok("Notebook written: the Banned list button no longer asks the bridge", sentOf(r, "white again sent") === "", sentOf(r, "white again sent"));
const tab2 = String(valueOf(r, "tab rewritten"));
ok("Notebook: a changed list rewrites the same tab (found by its title), no second tab", tab2.split("####").length === 2 && /1:Banned list=Modern: 4 banned \(Scryfall, 2026-11-19\)\./.test(tab2) && tab2.includes("Nadu, Winged Wisdom")
  && fxOf(r, "names changed").some((l) => /Notes\.editNotebookTab" 1 "Banned list"/.test(l)), tab2);
ok("Banned list label follows the names", btn(r, "tile rewritten", "onMtgSetupBanlist") === "Banned list\nModern: 4", valueOf(r, "tile rewritten"));
ok("Notebook: another format's names are not written over the chosen one's", valueOf(r, "other format names") === valueOf(r, "tab rewritten"), valueOf(r, "other format names"));
// typed
ok("mtg format: the format, its rules and the list", /Format: Modern \(60\+ cards.*\)\. Formats: Casual Commander, Commander, Duel Commander, .*Alchemy\. The host changes it:  mtg format <name>/.test(told(r, "list")), told(r, "list"));
ok("mtg format <bad name>: said, nothing changed", /No format called 'vintagee'/.test(told(r, "bad name")), told(r, "bad name"));
ok("mtg banlist refresh (host): asks the bridge, said", /^banlist \{"color":"Blue","refresh":true\}$/.test(sentOf(r, "refresh sent")) && /Asking the bridge to check the ban lists now/.test(told(r, "refresh")), `${sentOf(r, "refresh sent")} ${told(r, "refresh")}`);
// a format problem
ok("precondition: both READY, Start shows", /^onMtgSetupStart=Start;/.test(String(valueOf(r, "tile both ready"))), valueOf(r, "tile both ready"));
ok("a format problem: the deckReport turns the seat's button FIX DECK and Start goes", String(valueOf(r, "blue mat")).split(",").includes("FIX DECK") && !/=Start(;|$)/.test(String(valueOf(r, "tile problem"))), `${valueOf(r, "blue mat")} ${valueOf(r, "tile problem")}`);
// 2HG
ok("a 60-card format drops 2HG, said", valueOf(r, "2hg") === "2hg" && valueOf(r, "pioneer drops 2hg") === "nil|standard" && /Teams set back to None: Two-Headed Giant is played in Commander only/.test(told(r, "pioneer drops 2hg")), `${valueOf(r, "2hg")} ${valueOf(r, "pioneer drops 2hg")} ${told(r, "pioneer drops 2hg")}`);
// in a game
ok("in a game: the Format, switch and Banned list buttons are hidden", !/onMtgSetupMode|onMtgSetupBanned|onMtgSetupRestricted|onMtgSetupBanlist/.test(String(valueOf(r, "tile in game"))), valueOf(r, "tile in game"));

console.log(failed ? `FAILED: ${failed} failed, ${passed} passed` : `PASSED: ${passed} passed, 0 failed`);
process.exit(failed ? 1 : 0);
