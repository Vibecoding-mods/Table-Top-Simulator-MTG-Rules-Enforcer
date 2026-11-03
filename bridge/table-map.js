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
  identity: { to: ["n", "f", "b", "tok"], show: "name, picture, back; a token's picture", check: "hoverName" },
  color: { skip: "in the picture" },
  manaCost: { skip: "in the picture" },
  cmc: { to: ["cmc"], show: "sorts the battlefield and the hand; the hover name", check: "hoverName" },
  types: { to: ["ty", "tl"], show: "which row of the battlefield; the type line in the hover name", check: "hoverName" },
  subtypes: { to: ["tl"], show: "the type line in the hover name", check: "hoverName" },
  supertypes: { to: ["tl"], show: "the type line in the hover name", check: "hoverName" },
  power: { to: ["p"], show: "power/toughness badge when it differs from the picture", check: "badges" },
  toughness: { to: ["t"], show: "power/toughness badge when it differs from the picture", check: "badges" },
  basePower: { to: ["bp"], show: "what the badge compares against", check: "badges" },
  baseToughness: { to: ["bt"], show: "what the badge compares against", check: "badges" },
  printedPower: { to: ["bp"], show: "what the badge compares against", check: "badges" },
  printedToughness: { to: ["bt"], show: "what the badge compares against", check: "badges" },
  text: { to: ["tx"], show: "the hover text", check: "hoverText" },
  currentText: { to: ["ct"], show: "a box over the card's text box", check: "badges" },
  printedName: { to: ["pn"], show: "its printed name when an effect renamed it", check: "hoverText" },
  keywords: { to: ["kw", "ow"], show: "the status box: the keywords another card gave it, and its own always-on ones", check: "badges" },
  controllerId: { to: ["ctl"], show: "lies on its controller's mat", check: "place" },
  ownerId: { skip: "the zone it comes in names the owner; only control differs, and that shows" },
  tapped: { to: ["tap"], show: "turned sideways", check: "tapped" },
  counters: { to: ["ctr"], show: "counter badges", check: "counters" },
  damage: { to: ["dmg"], show: "the toughness on the badge is what is left", check: "badges" },
  isAttacking: { to: ["atk"], show: "moved forward, glowing, with a line to what it attacks", check: "attack" },
  attackTargetId: { to: ["atkT"], show: "the attack line", check: "attackLine" },
  attachedTo: { to: ["att"], show: "lies under the card it is attached to", check: "attached" },
  isFaceDown: { to: ["fd"], show: "the card back", check: "faceDown" },
  isCopy: { to: ["cp"], show: "a COPY badge", check: "badges" },
  phasedOut: { to: ["po"], show: "stays in place, dimmed, PHASED OUT first in the status box", check: "phased" },
  exerted: { to: ["kw"], show: "the status box: doesn't untap next turn", check: "badges" },
  isForetold: { to: ["fo"], show: "foretold, in its owner's second hand or the playable row", check: "playable" },
  exiledWith: { to: ["ew"], show: "tucked under the card that exiled it", check: "linked" },
  returnsWhenHostLeaves: { to: ["rl"], show: "the hover text says it comes back when that card leaves", check: "hoverText" },
  encodedOn: { to: ["ew"], show: "shown with the creature it is encoded on", check: "linked" },
  mayPlay: { to: ["playable"], show: "the playable row on the mat", check: "playable" },
  mergedCardIds: { skip: "the merged cards ride as attachments; the log reads it" },
  isPlotted: { skip: "the log reads it; see gap isWarpExiled" },
  isTransformed: { skip: "identity is the face showing, so name and picture follow it" },
  isDoubleFaced: { skip: "the back is the other face; the log reads it" },
  zone: { skip: "the zone lists carry it" },
  foil: { skip: "cosmetic" },
  summoningSick: { to: ["kw"], show: "the status box on its controller's turn: a creature that can't attack yet", check: "badges" },
  isRingBearer: { to: ["kw"], show: "the status box: Ring-bearer", check: "badges" },
  isCrewed: { to: ["kw"], show: "the status box: Crewed", check: "badges" },
  isBestowed: { to: ["kw"], show: "the status box: Bestowed", check: "badges" },
  wouldDieInCombat: { gap: "Forge knows; the table could warn before blocks" },
  finalChapter: { to: ["kw"], show: "the status box: Chapter 2 of 3", check: "badges" },
  sagaChapters: { gap: "a Saga's chapters aren't listed" },
  classLevel: { to: ["kw"], show: "the status box: Level 2", check: "badges" },
  classLevels: { gap: "a Class's levels aren't listed" },
  commanderTax: { skip: "the mat's tax counter comes from the player's commander casts" },
  flashbackCost: { gap: "a card in the graveyard doesn't say what it costs to flash back" },
  madnessCost: { gap: "the madness cost shows only in the prompt" },
  isMadnessExiled: { gap: "a card exiled for madness looks like any exiled card" },
  isWarpExiled: { gap: "a warped card waiting in exile looks like any exiled card" },
  kickerCost: { skip: "the cast prompt offers it" },
  effectiveManaCost: { skip: "the mana question shows what is to pay" },
  attackingPlayerId: { skip: "attackTargetId says the same for the table" },
  attachmentIds: { skip: "attachedTo on each attachment says the same" },
  choices: { gap: "what a card chose as it entered (a colour, a type) isn't marked" },
};

// Keys tableCard sends that stand for no single CardDto field: combat worked out from the game's blocker list, and the
// bridge's own records of what Forge doesn't send
const TABLE_ONLY_KEYS = { blk: "blocking", blkOf: "the attackers it blocks", sick: "nothing reads it; the status box's mark is decided in the bridge, which knows whose turn it is", enc: "ew is a cipher link; the table treats it as any link" };

// Forge's zones -> where the table puts them. check: the words engineSelfCheck reports
const ZONES = {
  Battlefield: { table: "the player's mat", check: "wrong place" },
  Hand: { table: "the player's hand zone", check: "wrong place" },
  Graveyard: { table: "the pile beside the mat", check: "wrong place" },
  Exile: { table: "the pile beside the library", check: "wrong place" },
  Command: { table: "the commander labels", check: "wrong place" },
  Library: { table: "the deck's count; no cards of its own until drawn or milled" },
  Attractions: { gap: "no attraction deck on the table" },
  Junkyard: { gap: "no junkyard on the table" },
  Sideboard: { skip: "outside the game" },
};

// What a gesture asks. The engine answers: the table moves a card only once the engine's next board says it moved.
const GESTURES = {
  play: "a card dragged onto the mat: the matching cast or land action, or a question when there are several",
  discard: "a card dragged to the graveyard: the answer to a discard question",
  sacrifice: "a permanent dragged to the graveyard: the answer to a sacrifice question or its ability",
  bottom: "a card dragged onto the library: the answer to a put-back question",
  attach: "an Aura or Equipment dragged onto a card: its target",
  tapmana: "a land or mana source tapped: its mana ability",
  choose: "a card clicked: the answer to a question that lists it",
};

module.exports = { CARD_FACTS, TABLE_ONLY_KEYS, ZONES, GESTURES };
