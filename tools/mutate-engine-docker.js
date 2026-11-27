// Break-its for the big-turns-2 engine work, run in a harness test image (no local Java needed). Each mutation switches
// one piece off in a COPY of one file (the trees are never written), the image compiles only that copy over the patched
// build (engine/checks/mutate-in-image.sh) and runs the test class, and the named check must fail.
//   node tools/mutate-engine-docker.js --harness <manabrew tree> --forge <forge tree> [--proto <generated protocol dir>]
//        [--image mtg-harness-test:l2-ai] [--set tie|tokens|runaway|held|watchdog|golden|all] [--only <label regex>]
// Heavy: run it through tmp/slot.js's queue (it does so itself when MTG_SLOT is set to slot.js's path).
require("./restore-on-interrupt"); // (a mutated source file is put back on exit or Ctrl+C)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const HARNESS = arg("harness"), FORGE = arg("forge"), PROTO = arg("proto"), IMAGE = arg("image", "mtg-harness-test:l2-ai");
const SET = arg("set", "all"), only = arg("only") ? new RegExp(arg("only"), "i") : null;
const PATCH = path.join(__dirname, "..", "engine", "forge.patch");
if (!HARNESS || !FORGE) { console.log("usage: --harness <manabrew tree> --forge <forge tree>"); process.exit(2); }

const H = "forge-harness/src/main/java/forge/harness/host/";
const G = "forge-game/src/main/java/forge/game/";
// set: [label, tree (mb | forge), file, from, to, test class, check that must fail]
const SETS = {
  tie: [
    ["the offer doesn't wait for the last player who can lose", "mb", H + "TieOffer.java", "if (waitUntilOneCanLose && game.getPlayers()", "if (false && game.getPlayers()", "TieOfferTest", "multiplayer: one lock among three waits until one player can lose"],
    ["the wait can't be switched off", "mb", H + "TieOffer.java", "        this.waitUntilOneCanLose = waitUntilOneCanLose;", "        this.waitUntilOneCanLose = true;", "TieOfferTest", "multiplayer: with the wait off one lock offers at once"],
    ["decking doesn't break a lock", "mb", H + "TieOffer.java", "        if (deckingBreaksLock && !out.isEmpty()", "        if (false && !out.isEmpty()", "TieOfferTest", "decking: a player who can deck out is no lock"],
    ["decking breaks a lock even with no loss to an empty library", "mb", H + "TieOffer.java", " && !player.cantLoseCheck(GameLossReason.Milled)) {", ") {", "TieOfferTest", "decking: a player who can't lose to an empty library keeps the lock"],
  ],
  tokens: [
    ["the pile cap is not 500", "forge", G + "Game.java", "public static final int UNBOUNDED_TOKENS = 500;", "public static final int UNBOUNDED_TOKENS = 600;", "UnboundedTokensTest", "theCapIsFiveHundred"],
    ["no clamp per pile", "forge", G + "ability/effects/TokenEffectBase.java", "Math.min(Game.UNBOUNDED_TOKENS - pileSizes.getOrDefault(pile, 0),", "Math.min(Integer.MAX_VALUE,", "UnboundedTokensTest", "aFullPileTakesNoMore"],
    ["no clamp per effect", "forge", G + "ability/effects/TokenEffectBase.java", "                    Game.UNBOUNDED_TOKENS - madeByEffect));", "                    Integer.MAX_VALUE));", "UnboundedTokensTest", "oneEffectMakesAtMostTheCapAcrossPiles"],
    ["a clamped pile not marked", "forge", G + "ability/effects/TokenEffectBase.java", "                game.markUnboundedTokens(pile);", "", "UnboundedTokensTest", "oneOverTheCapMakesTheCapAndFlagsThePile"],
    ["the cap itself marks the pile", "forge", G + "ability/effects/TokenEffectBase.java", "            if (cellAmount < c.getValue()) {", "            if (cellAmount <= c.getValue()) {", "UnboundedTokensTest", "theCapItselfIsNotUnbounded"],
    ["the pile counted before the doublers", "forge", G + "ability/effects/TokenEffectBase.java", "            int cellAmount = Math.min(c.getValue(), room);", "            int cellAmount = Math.min(c.getValue(), room / 8 * 8);", "UnboundedTokensTest", "doublersCountBeforeTheClamp"],
    ["the made count not carried between cells", "forge", G + "ability/effects/TokenEffectBase.java", "            madeByEffect += cellAmount;", "", "UnboundedTokensTest", "oneEffectMakesAtMostTheCapAcrossPiles"],
    ["the pile sizes not counted from the battlefield", "forge", G + "ability/effects/TokenEffectBase.java", "                pileSizes.merge(TokenPile.key(onField), 1, Integer::sum);", "", "UnboundedTokensTest", "manyEffectsStopAtTheCap"],
    ["the pile key keeps the tapped state", "forge", G + "card/TokenPile.java", " + card.getBaseToughness();", " + card.getBaseToughness() + card.isTapped();", "UnboundedTokensTest", "aTappedTokenStaysInItsPile"],
    ["the pile key drops the controller", "forge", G + "card/TokenPile.java", "return card.getController().getId() + \"|\" + card.getName()", "return card.getName()", "UnboundedTokensTest", "aStolenTokenLeavesThePile"],
    ["the pile key drops the name", "forge", G + "card/TokenPile.java", " + \"|\" + card.getName() + \"|\"", " + \"|\"", "UnboundedTokensTest", "anotherPileIsNotFlagged"],
    ["an emptied pile stays unbounded", "forge", G + "Game.java", "        unboundedTokenKeys.retainAll(present);", "", "UnboundedTokensTest", "losingOneKeepsTheFlagAndAWipeClearsIt"],
    ["the snapshot copy drops the piles", "forge", G + "GameSnapshot.java", "        fromGame.copyUnboundedTokenKeysTo(toGame);", "", "UnboundedTokensTest", "aSnapshotCopyKeepsTheFlag"],
    ["the view never says unbounded", "mb", H + "InteractiveSnapshotExtractor.java", "        dto.unbounded = card.isInPlay() && game.isUnboundedToken(card);", "", "UnboundedTokensTest", "theSnapshotMarksUnboundedTokens"],
    ["every token in play is unbounded in the view", "mb", H + "InteractiveSnapshotExtractor.java", "dto.unbounded = card.isInPlay() && game.isUnboundedToken(card);", "dto.unbounded = card.isInPlay() && card.isToken();", "UnboundedTokensTest", "theSnapshotMarksUnboundedTokens"],
  ],
  runaway: [
    ["the trigger ask moved off 5,000", "forge", G + "Game.java", "DEFAULT_RUNAWAY_TRIGGERS_PER_TURN = 5_000;", "DEFAULT_RUNAWAY_TRIGGERS_PER_TURN = 25_000;", "BigTurnsTest", "theDefaultLimitsAreTheMeasuredOnes"],
    ["the card ask moved off 2,500", "forge", G + "Game.java", "DEFAULT_RUNAWAY_CARDS_PER_TURN = 2_500;", "DEFAULT_RUNAWAY_CARDS_PER_TURN = 25_000;", "BigTurnsTest", "theDefaultLimitsAreTheMeasuredOnes"],
    ["a yes no longer allows another cap", "forge", G + "Game.java", "            triggersAllowedThisTurn = addCap(triggersAllowedThisTurn, runawayTriggersPerTurnCap);", "", "BigTurnsTest", "pastTheTriggerCapAYesKeepsTheTurnGoing"],
    ["the fourth cap draws again", "forge", G + "Game.java", "        } else if (!runawayTripped && runawayChoice != null) {", "        } else if (!runawayTripped && runawayChoice != null && triggersAllowedThisTurn < 3 * runawayTriggersPerTurnCap) {", "BigTurnsTest", "everyCapOfATurnAsks"],
    ["the heap never checked", "forge", G + "Game.java", "        return heapUsed.getAsDouble() > RUNAWAY_HEAP_LIMIT;", "        return false;", "BigTurnsTest", "aFullHeapDrawsAtALimitWithoutAsking"],
    ["two card caps draw whatever the heap", "forge", G + "Game.java", "addCap(limit, runawayCardsPerTurnCap) && heapNearlyFull()) {", "addCap(limit, runawayCardsPerTurnCap)) {", "BigTurnsTest", "twoCardCapsBeforeAnAskWaitForTheAsk"],
    ["a token effect doesn't ask a pending card cap", "forge", G + "Game.java", "    public void recordTokenEffect() {\n        resetRunawayWindowOnTurnChange();\n        askPendingRunaway();", "    public void recordTokenEffect() {\n        resetRunawayWindowOnTurnChange();", "BigTurnsTest", "twoCardCapsBeforeAnAskWaitForTheAsk"],
    ["a draw at a no says no reason", "forge", G + "Game.java", "            drawReason = runawayChoice == null ? \"noPerson\" : \"chosen\";", "            drawReason = null;", "BigTurnsTest", "theSessionsNoIsADraw"],
    ["the heap draw says no reason", "forge", G + "Game.java", "        if (!runawayTripped && heapNearlyFull()) {\n            drawReason = \"heap\";", "        if (!runawayTripped && heapNearlyFull()) {\n            drawReason = null;", "BigTurnsTest", "aFullHeapDrawsAtALimitWithoutAsking"],
    ["the stack never asks", "forge", G + "zone/MagicStack.java", "        game.recordStackSize(game.getStack().size());", "", "BigTurnsTest", "aStackOfAThousandAsksThroughMagicStack"],
    ["a yes at the stack allows nothing more", "forge", G + "Game.java", "        stackItemsAllowed = addCap(size, runawayStackItemsCap);", "", "BigTurnsTest", "theStackAtItsLimitAsks"],
    ["the stack asks past its limit, not at it", "forge", G + "Game.java", "        if (size < stackItemsAllowed) {", "        if (size <= stackItemsAllowed) {", "BigTurnsTest", "theStackAtItsLimitAsks"],
    ["a timeout draws at once", "mb", H + "ManaBrewInteractiveSession.java", "        if (missedRunawayInARow >= RUNAWAY_MISSES_TO_DRAW) {", "        if (missedRunawayInARow >= 1) {", "BigTurnsTest", "aTimeoutKeepsGoing"],
    ["timeouts never draw", "mb", H + "ManaBrewInteractiveSession.java", "        if (missedRunawayInARow >= RUNAWAY_MISSES_TO_DRAW) {", "        if (false) {", "BigTurnsTest", "twoTimeoutsInARowInATurnDraw"],
    ["an answer doesn't start the count over", "mb", H + "ManaBrewInteractiveSession.java", "            missedRunawayInARow = 0;\n", "", "BigTurnsTest", "anAnswerBetweenTimeoutsStartsTheCountOver"],
    ["a new turn doesn't start the count over", "mb", H + "ManaBrewInteractiveSession.java", "missedRunawayInARow = turn == missedRunawayTurn ? missedRunawayInARow + 1 : 1;", "missedRunawayInARow = missedRunawayInARow + 1;", "BigTurnsTest", "aTimeoutOnANewTurnStartsTheCountOver"],
    ["the unanswered draw says no reason", "mb", H + "ManaBrewInteractiveSession.java", "            g.setDrawReason(\"unanswered\");", "", "BigTurnsTest", "twoTimeoutsInARowInATurnDraw"],
    ["no deadline on the question", "mb", H + "ManaBrewInteractiveSession.java", "                if (actionDeadlineNanos != 0 && System.nanoTime() - actionDeadlineNanos >= 0) {", "                if (false) {", "BigTurnsTest", "aTimeoutKeepsGoing"],
    ["the prompt doesn't say a timeout keeps going", "mb", H + "ManaBrewInteractiveSession.java", "counts as Keep going; two unanswered", "counts as nothing; two unanswered", "BigTurnsTest", "aTimeoutKeepsGoing"],
    ["the snapshot has no drawReason", "mb", H + "InteractiveSnapshotExtractor.java", "            view.put(\"drawReason\", game.getDrawReason());", "", "BigTurnsTest", "theSnapshotSaysWhyTheGameIsADraw"],
    ["the AI-only draw says no reason", "mb", H + "ManaBrewInteractiveSession.java", "            g.setDrawReason(\"noPerson\");\n            return false;", "            return false;", "BigTurnsTest", "aStuckLoopWithNoPersonIsADraw"],
    ["a late answer is taken", "mb", H + "ManaBrewInteractiveSession.java", "                    && action.get(\"answersPrompt\").getAsLong() == timedOutRunawayPrompt) {", "                    && false) {", "BigTurnsTest", "aLateAnswerToATimedOutQuestionIsDropped"],
    ["a timeout keeps no question id", "mb", H + "ManaBrewInteractiveSession.java", "                    timedOutRunawayPrompt = promptSeq;\n", "", "BigTurnsTest", "aLateAnswerToATimedOutQuestionIsDropped"],
    ["an answer carries no question id", "mb", H + "ManaBrewInteractiveSession.java", "        decoded.addProperty(\"answersPrompt\", promptSeq);\n", "", "BigTurnsTest", "aLateAnswerToATimedOutQuestionIsDropped"],
  ],
  held: [
    ["a new instant doesn't end the hold", "mb", H + "ManaBrewInteractiveController.java", "PriorityFastForward.exhaustEnded(game, exhaustStackIds) || heldActionsChanged()) {\n            return 0;", "PriorityFastForward.exhaustEnded(game, exhaustStackIds)) {\n            return 0;", "HeldPassResponseTest", "aNewInstantEndsTheHold"],
    ["a held action counts as new", "mb", H + "ManaBrewInteractiveController.java", "ActionSpace.getPossibleActions(player, false, true, heldActionIds);", "ActionSpace.getPossibleActions(player, false, true, Set.of());", "HeldPassResponseTest", "aHeldInstantKeepsTheHold"],
    ["the held check never looks again", "mb", H + "ManaBrewInteractiveController.java", "        if (stamp.equals(heldCheckStamp)) {", "        if (heldCheckStamp != null) {", "HeldPassResponseTest", "aNewInstantEndsTheHold"],
    ["every hold ends at once", "mb", H + "ManaBrewInteractiveController.java", "        if (heldActionIds == null) {\n            return false;", "        if (heldActionIds == null) {\n            return true;", "BigTurnsTest", "theSessionMergesOnlyWhileEveryoneHolds"],
    ["the cleared hold keeps its actions", "mb", H + "ManaBrewInteractiveController.java", "        exhaustStackIds = null;\n        heldActionIds = null;\n    }", "        exhaustStackIds = null;\n    }", "HeldPassResponseTest", "clearingTheHoldForgetsTheActions"],
  ],
  watchdog: [
    ["the watchdog waits 120 s", "forge", G + "Game.java", "public static final long LOOP_WATCHDOG_SECONDS = 60;", "public static final long LOOP_WATCHDOG_SECONDS = 120;", "BigTurnsTest", "theDefaultLimitsAreTheMeasuredOnes"],
    ["the watchdog never asks", "forge", G + "Game.java", "        if (stuck < LOOP_WATCHDOG_SECONDS * 1_000_000_000L) {", "        if (true) {", "BigTurnsTest", "aStuckLoopAsksAfterSixtySeconds"],
    ["a yes at the watchdog gives no more time", "forge", G + "Game.java", "            if (keep) {\n                noteLoopProgress();", "            if (keep) {", "BigTurnsTest", "aStuckLoopAsksAfterSixtySeconds"],
    ["a trigger is no progress", "forge", G + "Game.java", "        resetRunawayWindowOnTurnChange();\n        noteLoopProgress();\n        askPendingRunaway();", "        resetRunawayWindowOnTurnChange();\n        askPendingRunaway();", "BigTurnsTest", "aTriggerOrACardIsProgress"],
    ["a card is no progress", "forge", G + "Game.java", "        resetRunawayWindowOnTurnChange();\n        noteLoopProgress();\n        cardsCreatedThisTurn++;", "        resetRunawayWindowOnTurnChange();\n        cardsCreatedThisTurn++;", "BigTurnsTest", "aTriggerOrACardIsProgress"],
    ["an ability resolving doesn't check", "forge", G + "ability/AbilityUtils.java", "        final Game game = pl.getGame();\n        game.checkLoopWatchdog();\n", "        final Game game = pl.getGame();\n", "BigTurnsTest", "anAbilityResolvingChecksTheWatchdog"],
    ["a replacement run doesn't check", "forge", G + "replacement/ReplacementHandler.java", "        game.checkLoopWatchdog();\n        final Object affected", "        final Object affected", "BigTurnsTest", "aReplacementRunChecksTheWatchdog"],
    ["a resolution starting is no progress", "forge", G + "zone/MagicStack.java", "    public final void resolveStack() {\n        game.noteLoopProgress();", "    public final void resolveStack() {", "BigTurnsTest", "aResolutionStartingIsProgress"],
    ["an unanswered stuck loop keeps going", "mb", H + "ManaBrewInteractiveSession.java", "        if (Game.STUCK_LOOP.equals(what)) {\n            g.setDrawReason(\"stuckLoop\");\n            return false;", "        if (false) {", "BigTurnsTest", "aStuckLoopNobodyAnswersIsADraw"],
    ["an answered action is no progress", "mb", H + "ManaBrewInteractiveSession.java", "            game.noteLoopProgress();\n            final String kind", "            final String kind", "BigTurnsTest", "anAnsweredActionIsProgress"],
  ],
};

// The Java golden masters (engine/checks/harness-tests.sh: ProtocolGoldenTest, SnapshotGoldenTest, 2026-11-24): the
// adversary pass of careless edits. A name ending in " *" matches by prefix (golden keys carry the input JSON).
const P = H + "ManabrewProtocolAdapter.java", S = H + "ManaBrewInteractiveSession.java", X = H + "InteractiveSnapshotExtractor.java";
const A = H + "ManaBrewEngineAdapter.java", PG = "ProtocolGoldenTest", SG = "SnapshotGoldenTest";
SETS.golden = [
  ["one colour counted as a combo", "mb", P, "        if (total <= 1) {", "        if (total < 1) {", PG, "golden decodeAction chooseColor.oneRed *"],
  ["colourless not a mana letter", "mb", P, " || \"G\".equals(token) || \"C\".equals(token);", " || \"G\".equals(token);", PG, "golden decodeAction chooseAction.tapIndexColorless *"],
  ["the first colon read as the last", "mb", P, "        final int lastColon = rest.lastIndexOf(':');", "        final int lastColon = rest.indexOf(':');", PG, "golden decodeAction chooseAction.tapIndexColor *"],
  ["exhaustStack false read as true", "mb", P, "                && output.get(\"exhaustStack\").getAsBoolean()) {", "                ) {", PG, "golden decodeAction chooseAction.passExhaustFalse *"],
  ["a null number not read as 0", "mb", P, "output.has(\"chosenNumber\") && !output.get(\"chosenNumber\").isJsonNull()", "output.has(\"chosenNumber\")", PG, "golden decodeAction chooseNumber.null *"],
  ["a blank ability text sent", "mb", P, "!sourceAbilityText.isBlank()", "!sourceAbilityText.isEmpty()", PG, "golden agentPrompt blank ability"],
  ["an empty decider sent", "mb", P, "decidingPlayerId != null && !decidingPlayerId.isEmpty()", "decidingPlayerId != null", PG, "golden agentPrompt empty decider"],
  ["a tie vote read as a restore vote", "mb", P, "                flat.addProperty(\"kind\", \"tie_vote\");", "                flat.addProperty(\"kind\", \"restore_vote\");", PG, "golden decodeAction directive.tieVote *"],
  ["no card count floor in the checkpoint cap", "mb", S, "CHECKPOINT_BYTES_PER_CARD * Math.max(1, cards);", "CHECKPOINT_BYTES_PER_CARD * cards;", PG, "golden checkpointCap 0"],
  ["no floor of one checkpoint", "mb", S, "        return (int) Math.max(1, Math.min(MAX_CHECKPOINTS,", "        return (int) (Math.min(MAX_CHECKPOINTS,", PG, "golden checkpointCap 100000"],
  ["thinning ignores the kept point", "mb", S, "            if (c.turn != current && previous != null && previous.turn == c.turn && c != keep) {", "            if (c.turn != current && previous != null && previous.turn == c.turn) {", PG, "golden thinCheckpoints [1, 1, 2, 2, 3, 3, 3] cap 4 keep 1"],
  ["thinning drops the first of a pair", "mb", S, "previous != null && previous.turn == c.turn && c != keep) {\n                return c;", "previous != null && previous.turn == c.turn && previous != keep) {\n                return previous;", PG, "golden thinCheckpoints [1, 1, 2, 2, 3, 3, 3] cap 4 keep -1"],
  ["the cap printed without grouping", "mb", S, "\", past the engine's limit of %,d.", "\", past the engine's limit of %d.", PG, "golden runawayWords triggers fired 1234567 5000"],
  ["three misses to draw", "mb", S, "static final int RUNAWAY_MISSES_TO_DRAW = 2;", "static final int RUNAWAY_MISSES_TO_DRAW = 3;", PG, "golden runawayWords constants"],
  ["extra-phase arguments swapped", "mb", H + "PriorityFastForward.java", "current != null && maxSeen != null && current.isBefore(maxSeen)", "current != null && maxSeen != null && maxSeen.isBefore(current)", PG, "golden invalidatedByExtraPhase maxSeen COMBAT_END"],
  ["perks refuse replacements", "mb", H + "Perks.java", "List.of(\"Name:\", \"Oracle:\", \"SVar:\", \"T:\", \"S:\", \"R:\")", "List.of(\"Name:\", \"Oracle:\", \"SVar:\", \"T:\", \"S:\")", PG, "golden Perks.check ['Name:Juggernaut', *"],
  ["a null perk line not refused by name", "mb", H + "Perks.java", "            if (line == null || kind(line) == null) {", "            if (kind(line) == null) {", PG, "golden Perks.check ['Name:x', null]"],
  ["team seats not read round the table", "mb", A, "seats.get((i + 1) % seats.size()).getTeam()", "seats.get(Math.min(i + 1, seats.size() - 1)).getTeam()", PG, "golden start sharedLife 2v2 together Constructed"],
  ["2HG poison not scaled by heads", "mb", A, "? request.getPoisonToLose() : 15 + 5 * (heads - 2));", "? request.getPoisonToLose() : 15 + 5 * heads);", PG, "golden start sharedLife 2v2 together Constructed"],
  ["a poison limit of one refused", "mb", A, "request.getPoisonToLose() != null && request.getPoisonToLose() < 1", "request.getPoisonToLose() != null && request.getPoisonToLose() <= 1", PG, "golden start sharedLife poison one Constructed"],
  ["Commander team life not scaled", "mb", A, "gameType == GameType.Commander ? 40 * heads : 30 + 15 * (heads - 2)", "gameType == GameType.Commander ? 40 : 30 + 15 * (heads - 2)", PG, "golden start sharedLife 3v3 Commander"],
  ["a spectator sees face-down exile", "mb", X, "        if (zone == ZoneType.Exile || zone == ZoneType.Merged) {\n            return !card.isFaceDown();", "        if (zone == ZoneType.Exile || zone == ZoneType.Merged) {\n            return true;", SG, "golden snapshot hidden viewer -1"],
  ["a spectator can't see graveyards", "mb", X, "                || zone == ZoneType.Graveyard\n", "", SG, "golden snapshot delayed viewer -1"],
  ["a conceded player shown as lost", "mb", X, "player.conceded() ? \"conceded\" : player.hasLost()", "player.hasLost() ? \"lost\" : player.conceded()", SG, "golden snapshot lost viewer 0"],
  ["phasing never sent", "mb", X, "        dto.phasedOut = card.isPhasedOut();", "        dto.phasedOut = false;", SG, "golden snapshot flags viewer 0"],
  ["storm sent at zero", "mb", X, "        if (stormCount > 0) {", "        if (stormCount >= 0) {", SG, "golden snapshot quiet viewer 0"],
  ["a face-down permanent hidden from its controller", "mb", X, "        return card.getController() == viewerPlayer\n                || card.getView()", "        return card.getView()", SG, "golden snapshot hidden viewer 0"],
  ["monstrous never sent", "mb", X, "        dto.monstrous = card.isMonstrous();", "", SG, "golden snapshot flags viewer 2"],
  ["a move loses its from zone", "mb", H + "EngineEventLog.java", "                event.put(\"from\", entry.from.name());", "", SG, "golden snapshot moves viewer 0"],
  ["an emblem not flagged", "mb", H + "EffectsView.java", "            effect.put(\"emblem\", card.isEmblem());", "            effect.put(\"emblem\", false);", SG, "golden snapshot effects viewer 0"],
  ["a zero-count colour taken", "mb", P, "                if (entry.getValue().getAsInt() > 0) {", "                if (entry.getValue().getAsInt() >= 0) {", PG, "golden decodeAction chooseColor.zeroRedOneGreen *"],
  ["a fix with ops not an array let through", "mb", P, "if (!directive.has(\"ops\") || !directive.get(\"ops\").isJsonArray()) {", "if (!directive.has(\"ops\")) {", PG, "golden decodeAction directive.applyStateOpsObject *"],
  ["a fix with no ops reaches the game", "mb", S, "        if (!action.has(\"ops\") || !action.get(\"ops\").isJsonArray()) {\n            publishStateFix(fixId, false, \"the fix has no ops array\");\n            return false;\n        }\n", "", SG, "golden snapshot fixnoops *"],
  ["a spectator reads an LKI host's zone as none", "mb", X, "card.getZone() != null ? card.getZone() : card.getLastKnownZone()", "card.getZone()", SG, "golden snapshot delayed viewer -1"],
  ["clearing a held pass keeps the exhaust", "mb", H + "ManaBrewInteractiveController.java", "        clearPassUntil();\n        clearExhaust();\n    }", "        clearPassUntil();\n    }", "HeldPassResponseTest", "clearingTheHoldForgetsTheActions"],
  ["an ended exhaust keeps its actions", "mb", H + "ManaBrewInteractiveController.java", "        exhaustStackIds = null;\n        heldActionIds = null;\n    }\n\n    void clearHeldPass", "        exhaustStackIds = null;\n    }\n\n    void clearHeldPass", "HeldPassResponseTest", "clearingTheHoldForgetsTheActions"],
  ["a held exhaust forgets the actions it was offered", "mb", H + "ManaBrewInteractiveController.java", "heldActionIds = choice.exhaustStack() ? responseIds(all) : null;", "heldActionIds = null;", "HeldPassResponseTest", "aNewInstantEndsTheHold"],
];

// the cloud's tie-offer break-its (tools/mutate-tie-offer-engine.js needs a local JDK), read from that file as they are
SETS["tie-cloud"] = (() => {
  const src = fs.readFileSync(path.join(__dirname, "mutate-tie-offer-engine.js"), "utf8");
  const body = src.slice(src.indexOf("const MUTATIONS = [") + "const MUTATIONS = [".length, src.indexOf("\n];", src.indexOf("const MUTATIONS = [")));
  return new Function("H", "T", `return [${body}];`)(H, H + "TieOffer.java").map(([label, file, from, to, name]) => [label, "mb", file, from, to, "TieOfferTest", name]);
})();
const list = (SET === "all" ? Object.values(SETS).flat() : SETS[SET] || []).filter((m) => !only || only.test(m[0]));
if (!list.length) { console.log(`no mutations in set ${SET}`); process.exit(2); }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mutate-engine-"));
const classes = [...new Set(list.map((m) => m[5]))];
const dirs = [];
classes.forEach((cls, i) => { const d = path.join(tmp, `m${String(i).padStart(3, "0")}`); fs.mkdirSync(d); fs.writeFileSync(path.join(d, "class"), cls); dirs.push({ d, base: true, cls }); });
let notApplied = 0;
list.forEach((m, i) => {
  const [label, tree, file, from, to, cls] = m;
  const src = fs.readFileSync(path.join(tree === "mb" ? HARNESS : FORGE, file), "utf8");
  const crlf = src.includes("\r\n"), text = src.replace(/\r\n/g, "\n");
  if (text.split(from).length !== 2) { notApplied++; console.log(`NOT APPLIED ${label}`); return; }
  const d = path.join(tmp, `m${String(500 + i).padStart(3, "0")}`);
  const out = path.join(d, "src", file.replace(/^.*?src\/main\/java\//, ""));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const next = text.replace(from, to);
  fs.writeFileSync(out, crlf ? next.replace(/\n/g, "\r\n") : next);
  fs.writeFileSync(path.join(d, "class"), cls);
  dirs.push({ d, m });
});
const win = (p) => p.replace(/\\/g, "/");
const docker = ["docker", "run", "--rm",
  "-v", `${win(path.join(HARNESS, "forge-harness"))}:/src:ro`, "-v", `${win(FORGE)}:/fsrc:ro`, "-v", `${win(PATCH)}:/forge.patch:ro`,
  ...(PROTO ? ["-v", `${win(PROTO)}:/proto:ro`] : []), "-v", `${win(tmp)}:/mut`,
  "-v", `${win(path.join(__dirname, "..", "engine", "checks", "mutate-in-image.sh"))}:/mutate.sh:ro`, "--entrypoint", "sh", IMAGE, "/mutate.sh"];
const cmd = process.env.MTG_SLOT ? ["node", process.env.MTG_SLOT, ...docker] : docker;
const r = spawnSync(cmd[0], cmd.slice(1), { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 1 << 26 });
if (r.status !== 0) { console.log(`${r.stdout}${r.stderr}`.slice(-4000)); process.exit(1); }
const fails = (d) => { const f = path.join(d, "result"); const t = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "NO RESULT"; return { t, names: t.split("\n").filter((l) => l.startsWith("FAIL ")).map((l) => l.slice(5)) }; };
let bad = 0;
for (const x of dirs.filter((x) => x.base)) {
  const { t, names } = fails(x.d);
  if (names.length || !/^PASS /m.test(t)) { bad++; console.log(`BASELINE FAILS ${x.cls}: ${names.join(" | ") || t.slice(-400)}`); }
}
let caught = 0;
for (const x of dirs.filter((x) => x.m)) {
  const [label, , , , , , name] = x.m;
  const { t, names } = fails(x.d);
  const hit = name.endsWith(" *") ? names.some((n) => n.startsWith(name.slice(0, -1)))
    : names.some((n) => n.startsWith(`${name}:`) || n === name);
  if (hit) caught++;
  console.log(`${hit ? "caught  " : "MISSED  "} ${label}: ${names.join(" | ").slice(0, 300) || (/COMPILE ERROR/.test(t) ? "COMPILE ERROR " + t.split("\n")[0] : "nothing failed")}`);
}
fs.rmSync(tmp, { recursive: true, force: true });
const total = dirs.filter((x) => x.m).length;
console.log(`${caught} of ${total} caught by name${notApplied ? `, ${notApplied} not applied` : ""}; the trees were not written`);
process.exit(bad || notApplied || caught !== total ? 1 : 0);
