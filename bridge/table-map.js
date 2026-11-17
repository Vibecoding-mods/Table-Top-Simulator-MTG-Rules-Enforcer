// The map between the engine and the table: what each engine fact becomes on the table, where each engine zone lies, and
// what each table gesture asks the engine. Forge alone decides the rules; nothing here decides anything. This file says
// what a player must be able to SEE and DO, so a fact the table doesn't show is a named gap, not a surprise in a game.
// tests/test_table_map.js holds it to the code: a CardDto field or a table key missing from here fails, a key that no
// longer exists fails, and a check named here has to exist in engineSelfCheck (tools/engine-renderer.lua).
//
// CARD_FACTS: Forge's CardDto field -> { to: keys in the bridge's tableCard, show: what a player sees, check: its line in
// engineSelfCheck (absent: nothing compares it on the live table yet) }, or { gap: what is missing }, or { skip: why not }.
const CARD_FACTS = {
  id: { to: ["id"], show: "the card object's GM note, engine:<id>", check: "present" },
  identity: { to: ["n", "f", "b", "o2", "n2", "t2", "tok"], show: "name, picture, back; a token's picture; a two-faced card's other face, its name and (Scryfall's) rules text in the hover, its second state; an adventure or flip card's other part by name and text (docs/card-other-side-spec.md)", check: "hoverName" },
  color: { skip: "in the picture" },
  // (with effectiveManaCost: the cost badge compares the two, docs/cost-badge-spec.md)
  manaCost: { to: ["mc"], show: "the printed cost the cost badge compares the cost now against (sent only with ec)", check: "cost" },
  cmc: { to: ["cmc"], show: "sorts the battlefield and the hand; the hover name", check: "hoverName" },
  types: { to: ["ty", "tl"], show: "which row of the battlefield; the type line in the hover name", check: "hoverName" },
  subtypes: { to: ["tl"], show: "the type line in the hover name", check: "hoverName" },
  supertypes: { to: ["tl"], show: "the type line in the hover name", check: "hoverName" },
  power: { to: ["p"], show: "power/toughness badge when it differs from the picture", check: "badges" },
  toughness: { to: ["t"], show: "power/toughness badge when it differs from the picture", check: "badges" },
  // (the badge compares against the picture's numbers: a base the picture doesn't show, an X/X token's 6, is no base)
  basePower: { to: ["f"], show: "a token's picture is searched for by it (tokenKey)" },
  baseToughness: { to: ["f"], show: "a token's picture is searched for by it (tokenKey)" },
  printedPower: { to: ["bp"], show: "what the badge compares against: the picture's numbers (a token's from its picture)", check: "badges" },
  printedToughness: { to: ["bt"], show: "what the badge compares against: the picture's numbers (a token's from its picture)", check: "badges" },
  text: { to: ["tx"], show: "the hover text", check: "hoverText" },
  currentText: { to: ["ct"], show: "a box over the card's text box", check: "badges" },
  printedName: { to: ["pn"], show: "its printed name when an effect renamed it", check: "hoverText" },
  keywords: { to: ["kw", "ow"], show: "the status box: the keywords another card gave it, and its own always-on ones", check: "badges" },
  controllerId: { to: ["ctl"], show: "lies on its controller's mat", check: "place" },
  ownerId: { to: ["kw"], show: "the status box: Owned by Blue, on a permanent another player controls", check: "badges" },
  tapped: { to: ["tap"], show: "turned sideways", check: "tapped" },
  counters: { to: ["ctr", "nt"], show: "counter badges; in a graveyard or exile, the hover text of the card and its pile; a suspended card (time counters, face up) lies half size beside its exile pile with its own \"2 Time\" badge, and the log counts them down", check: "counters" },
  damage: { to: ["dmg"], show: "the toughness on the badge is what is left", check: "badges" },
  isAttacking: { to: ["atk"], show: "moved forward, glowing, with a line to what it attacks", check: "attack" },
  attackTargetId: { to: ["atkT"], show: "the attack line", check: "attackLine" },
  attachedTo: { to: ["att"], show: "lies under the card it is attached to", check: "attached" },
  isFaceDown: { to: ["fd"], show: "the card back", check: "faceDown" },
  isCopy: { to: ["cp"], show: "a COPY badge", check: "badges" },
  phasedOut: { to: ["po"], show: "stays in place, dimmed, PHASED OUT first in the status box", check: "phased" },
  exerted: { to: ["kw"], show: "the status box: doesn't untap next turn", check: "badges" },
  isForetold: { to: ["fo"], show: "foretold, in its owner's second hand or the playable row; FORETOLD n under its owner's life total, a count only, for every player", check: "playable" },
  exiledWith: { to: ["ew"], show: "tucked under the card that exiled it", check: "linked" },
  returnsWhenHostLeaves: { to: ["rl"], show: "the hover text says it comes back when that card leaves", check: "hoverText" },
  encodedOn: { to: ["ew"], show: "shown with the creature it is encoded on", check: "linked" },
  mayPlay: { to: ["playable"], show: "the playable row on the mat", check: "playable" },
  mergedCardIds: { to: ["kw"], show: "the status box: Mutated: <the cards under it> under it (they also ride as attachments; the log reads it)", check: "badges" },
  isPlotted: { to: ["nt"], show: "the hover text of the card and its exile pile: plotted, castable free on a later turn", check: "hoverText" },
  isTransformed: { skip: "identity is the face showing, so name and picture follow it" },
  isDoubleFaced: { skip: "the back is the other face; the log reads it" },
  zone: { skip: "the zone lists carry it" },
  foil: { skip: "cosmetic" },
  summoningSick: { to: ["kw"], show: "the status box on its controller's turn: a creature that can't attack yet", check: "badges" },
  isRingBearer: { to: ["kw"], show: "the status box: Ring-bearer", check: "badges" },
  isCrewed: { to: ["kw"], show: "the status box: Crewed", check: "badges" },
  isBestowed: { to: ["kw"], show: "the status box: Bestowed", check: "badges" },
  wouldDieInCombat: { to: ["kw"], show: "the status box of an attacker or blocker: Dies in this combat as it stands", check: "badges" },
  finalChapter: { to: ["kw"], show: "the status box: Chapter 2 of 3", check: "badges" },
  sagaChapters: { to: ["kw"], show: "the status box: the next chapter and what it does", check: "badges" },
  classLevel: { to: ["kw"], show: "the status box: Level 2", check: "badges" },
  classLevels: { to: ["kw"], show: "the status box: what the next level costs", check: "badges" },
  commanderTax: { to: ["ec"], show: "a commander's cost badge in the command zone while the engine sends no effectiveManaCost (costNow's fallback); the mat's tax counter comes from the player's commander casts" },
  flashbackCost: { to: ["nt"], show: "the hover text of the card and its graveyard pile: Flashback {2}{R}", check: "hoverText" },
  madnessCost: { to: ["nt"], show: "with isMadnessExiled: the cost to cast it from exile", check: "hoverText" },
  isMadnessExiled: { to: ["nt"], show: "the hover text of the card and its exile pile: exiled for madness, and its cost", check: "hoverText" },
  isWarpExiled: { to: ["nt"], show: "the hover text of the card and its exile pile: warped, castable on a later turn", check: "hoverText" },
  kickerCost: { skip: "the cast prompt offers it" },
  effectiveManaCost: { to: ["ec"], show: "the cost badge on a hand or command-zone card (a counter over the generic pip, a colour chip) and the hover text's \"Costs ... now\"; the mana question still says what is paid", check: "cost" },
  attackingPlayerId: { skip: "attackTargetId says the same for the table" },
  attachmentIds: { skip: "attachedTo on each attachment says the same" },
  choices: { to: ["kw"], show: "the status box: Chosen colour: red; only a choice every human seat may see", check: "badges" },
  // (engine1112 card states, cardStateWords; battlefield cards only)
  skipsNextUntap: { to: ["kw"], show: "the status box: Doesn't untap next untap step (left out when exerted says it)", check: "badges" },
  monstrous: { to: ["kw"], show: "the status box: Monstrous", check: "badges" },
  saddled: { to: ["kw"], show: "the status box: Saddled, with saddledBy", check: "badges" },
  saddledBy: { to: ["kw"], show: "the status box: Saddled (by Grizzly Bears)", check: "badges" },
  harnessed: { to: ["kw"], show: "the status box: Harnessed", check: "badges" },
  solved: { to: ["kw"], show: "the status box: Solved (the bridge's log guess is the old engine's fallback)", check: "badges" },
  unlockedDoors: { to: ["kw"], show: "the status box: Unlocked: Bottomless Pool, or Both doors unlocked", check: "badges" },
  pairedWith: { to: ["kw"], show: "the status box: Paired with X", check: "badges" },
  attachedToPlayer: { to: ["attP", "kw"], show: "a curse lies in the cursed player's non-creature row (its controller can still move it); the status box: Attached to White", check: "place" },
  protectorId: { to: ["kw", "prot"], show: "the status box of a battle: Protected by White; prot, the protector's colour, names it in the table's attack line", check: "badges" },
  cantAttack: { to: ["kw"], show: "the status box: Can't attack (not on a card with Defender, whose own line says it)", check: "badges" },
  cantBlock: { to: ["kw"], show: "the status box: Can't block (not on a suspected card, whose own line says it)", check: "badges" },
  mustAttack: { to: ["kw"], show: "the status box: Must attack", check: "badges" },
};

// Keys tableCard sends that stand for no single CardDto field: combat worked out from the game's blocker list, and the
// bridge's own records of what Forge doesn't send
const TABLE_ONLY_KEYS = { blk: "blocking", blkOf: "the attackers it blocks", sick: "nothing reads it; the status box's mark is decided in the bridge, which knows whose turn it is", enc: "ew is a cipher link; the table treats it as any link",
  og: "a playable-row card from the graveyard: the FROM GRAVEYARD chip (the zone the bridge found it in, no CardDto field)",
  pk: "your own face-down card's face { n, f, v }: from each human seat's own view (facePeek), drawn as UI only those seats' colours see",
  inf: "CardDto.unbounded (big-turns-2 step 0, docs/big-turns-2-spec.md 1.6): a token pile the engine stopped counting at its cap; sent, and the table does not read it yet. It moves to CARD_FACTS when an engine with the field ships" };

// Forge's zones -> where the table puts them. check: the words engineSelfCheck reports
const ZONES = {
  Battlefield: { table: "the player's mat", check: "wrong place" },
  Hand: { table: "the player's hand zone", check: "wrong place" },
  Graveyard: { table: "the pile beside the mat", check: "wrong place" },
  Exile: { table: "the pile beside the library", check: "wrong place" },
  Command: { table: "the commander labels", check: "wrong place" },
  Library: { table: "the deck's count; no cards of its own until drawn or milled" },
  Attractions: { skip: "Unfinity's attractions: not legal in Commander" },
  Junkyard: { skip: "an Un-set zone: not legal in Commander" },
  Sideboard: { skip: "outside the game" },
};

// What a gesture asks. The engine answers: the table moves a card only once the engine's next board says it moved.
const GESTURES = {
  play: "a card dragged onto the mat: the matching cast or land action, or a question when there are several (a two-faced card: the side its object shows, side)",
  discard: "a card dragged to the graveyard: the answer to a discard question",
  sacrifice: "a permanent dragged to the graveyard: the answer to a sacrifice question or its ability",
  bottom: "a card dragged onto the library: the answer to a put-back question",
  attach: "an Aura or Equipment dragged onto a card: its target",
  tapmana: "a land or mana source tapped: its mana ability",
  choose: "a card clicked: the answer to a question that lists it",
};

// PLAYER_FACTS: Forge's PlayerDto field -> { to: keys of the bridge's player row (sendTable), show }, or { gap }, or
// { skip }. The marks land in "allMarks", the whole label under the player's life in order (bridge PLAYER_MARKS,
// trackMarks, playerMarks); the old "marks" and the six fields poison, energy, monarch, initiative, blessed and story
// went in docs/core-moves-cleanup-plan.md "2. trackMarks" step 6. A PLAYER_MARKS row with no label (extra turns) has a
// row key of its own, its `row`, sent by playerMarks beside allMarks.
const PLAYER_FACTS = {
  id: { to: ["slot"], show: "which seat" },
  name: { to: ["name"], show: "the seat's name" },
  status: { to: ["status"], show: "a player who lost or conceded" },
  isHuman: { to: ["ai"], show: "an AI seat" },
  life: { to: ["life"], show: "the life counter" },
  maxHandSize: { to: ["allMarks"], show: "MAX HAND 5 when it isn't seven" },
  unlimitedHandSize: { to: ["allMarks"], show: "NO MAX HAND SIZE" },
  landsPlayedThisTurn: { skip: "the land play is refused with a reason when none is left" },
  maxLandPlaysPerTurn: { skip: "as landsPlayedThisTurn" },
  unlimitedLandPlays: { skip: "as landsPlayedThisTurn" },
  cardsDrawnThisTurn: { skip: "the log says each draw" },
  damagePrevention: { to: ["allMarks"], show: "PREVENT 3" },
  isExtraTurn: { to: ["allMarks"], show: "EXTRA TURN on the player taking it; the turn header's \"(extra turn)\"" },
  extraTurnCount: { to: ["extraTurns"], show: "a badge beside the life counter while extra turns are coming, counted from 1: EXTRA TURN for one, EXTRA TURN 2x for two, hover \"AI 1 has 1 extra turn coming\"; the log says each one added, \"White will take an extra turn (1 coming)\"" },
  controlledBy: { to: ["allMarks"], show: "TURN RUN BY BLUE (Mindslaver), CONTROLLED BY BLUE (Opposition Agent's search); the log says when it starts and ends" },
  playerKeywords: { to: ["allMarks"], show: "HEXPROOF, YOU CAN'T LOSE THE GAME" },
  commanderCasts: { to: ["tax"], show: "the commander tax counter" },
  dungeonState: { to: ["dungeon"], show: "the room box on the dungeon card (ROOM, NEXT or FIRST, LAST ROOM), its tooltip the room's text; the dungeon's own spot past the second tax label; the log says each room ventured into" },
  completedDungeons: { to: ["allMarks", "dungeonsDone"], show: "DUNGEONS 2; COMPLETED: 2 in the room box; the log says each completion, \"White completes Lost Mine of Phandelver (1 dungeon completed)\"" },
  activeSchemeNames: { skip: "Archenemy: no schemes on this table" },
  teamNumber: { skip: "no team games on this table" },
  counters: { to: ["allMarks"], show: "POISON 3, ENERGY 2, EXPERIENCE, RAD, TICKETS" },
  manaPool: { to: ["pool"], show: "your own floating mana in your status line, and every other player's that isn't empty under it" },
  commanderDamage: { to: ["cmdDamage", "cmdTip"], show: "commander damage by seat: the most from one commander; with partners each one's in the tracker's tooltip; the log's life line adds \"commander damage from Kenrith: 14 in all\"" },
  hasCityBlessing: { to: ["allMarks"], show: "CITY'S BLESSING" },
  hasEnduringStory: { to: ["allMarks"], show: "ENDURING STORY" },
  ringLevel: { to: ["allMarks"], show: "RING TEMPTED 2: LOOTS ON ATTACK (the newest level's ability), every level reached in its hover; the log says each temptation" },
  speed: { to: ["allMarks"], show: "SPEED 3; the log says each change" },
  // (engine1112)
  effects: { to: ["allMarks", "markTips"], show: "effect and emblem marks, FOG THIS TURN, EMBLEM: GIDEON, +N MORE EFFECTS; each box's own hover the full text (dropped when a card it names is hidden)" },
  spellsCastThisTurn: { to: ["allMarks"], show: "SPELLS THIS TURN: 2 (STORM 3) on the active player" },
  lifeGainedThisTurn: { to: ["lifeTip"], show: "the life counter's hover: Gained 5 life this turn" },
  lifeLostThisTurn: { to: ["lifeTip"], show: "the life counter's hover: Lost 4 life this turn" },
  // (engine1119, the Archenemy view; the marker is plan step 9, cloud/archenemy-polish)
  isArchenemy: { gap: "the table marks the archenemy (phase bar tag, gold mat line), but from the board's teams.archenemy, which the bridge fills from its own setting; this field itself isn't read (no player-row key carries it)" },
  schemeDeckCount: { gap: "the scheme deck's size isn't shown yet" },
  schemes: { gap: "schemes in motion aren't shown yet; the log says each set in motion" },
};

module.exports = { CARD_FACTS, TABLE_ONLY_KEYS, ZONES, GESTURES, PLAYER_FACTS };
