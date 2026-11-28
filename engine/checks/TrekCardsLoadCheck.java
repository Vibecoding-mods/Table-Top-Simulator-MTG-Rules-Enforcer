package forge.harness.host;

import forge.StaticData;
import forge.ai.LobbyPlayerAi;
import forge.card.CardEdition;
import forge.card.CardStateName;
import forge.deck.CardPool;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameType;
import forge.game.Match;
import forge.game.ability.AbilityFactory;
import forge.game.card.Card;
import forge.game.card.CardFactory;
import forge.game.card.CardState;
import forge.game.keyword.Keyword;
import forge.game.keyword.KeywordInterface;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.gui.GuiBase;
import forge.harness.common.HeadlessGuiBase;
import forge.item.IPaperCard;
import forge.item.PaperCard;
import forge.item.PaperToken;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;

// Loads every card and token of the given editions through Forge and parses every ability, SVar ability,
// trigger, static and replacement; prints the failures and the keywords Forge does not know as enum keywords.
// It fails with no edition named and on an edition with no cards; the non-enum keywords are listed, never counted.
//   java -cp <harness jar>:<this class> forge.harness.host.TrekCardsLoadCheck TRK TRC
public final class TrekCardsLoadCheck {
    public static void main(final String[] args) {
        GuiBase.setInterface(new HeadlessGuiBase("forge/forge-gui/"));
        FModel.initialize(null, prefs -> {
            prefs.setPref(FPref.LOAD_CARD_SCRIPTS_LAZILY, true);
            prefs.setPref(FPref.UI_LANGUAGE, "en-US");
            return null;
        });
        final List<RegisteredPlayer> players = new ArrayList<>();
        players.add(new RegisteredPlayer(new Deck()).setPlayer(new LobbyPlayerAi("p1", null)));
        players.add(new RegisteredPlayer(new Deck()).setPlayer(new LobbyPlayerAi("p2", null)));
        final GameRules rules = new GameRules(GameType.Constructed);
        final Game game = new Game(players, rules, new Match(rules, players, "TrekCardsLoadCheck"));
        final Player owner = game.getPlayers().get(0);

        int failures = 0;
        if (args.length == 0) {
            System.out.println("FAIL no edition named: give edition codes, TRK TRC");
            failures++;
        }
        final Map<String, TreeSet<String>> undefinedKeywords = new TreeMap<>();
        for (final String code : args) {
            final CardEdition edition = StaticData.instance().getEditions().get(code);
            if (edition == null) {
                System.out.println("FAIL no edition " + code);
                failures++;
                continue;
            }
            final TreeSet<String> names = new TreeSet<>();
            for (final CardEdition.EditionEntry entry : edition.getAllCardsInSet()) {
                names.add(entry.name());
            }
            if (names.isEmpty()) {
                System.out.println("FAIL " + code + " has no cards");
                failures++;
            }
            int loaded = 0;
            for (final String name : names) {
                IPaperCard paper = FModel.getMagicDb().getCommonCards().getCard(name);
                if (paper == null) {
                    StaticData.instance().attemptToLoadCard(name);
                    paper = FModel.getMagicDb().getCommonCards().getCard(name);
                }
                if (paper == null) {
                    System.out.println("FAIL " + code + " no script: " + name);
                    failures++;
                    continue;
                }
                try {
                    final Card card = Card.fromPaperCard(paper, owner);
                    parseAll(card, undefinedKeywords);
                    loaded++;
                } catch (final Throwable error) {
                    System.out.println("FAIL " + code + " " + name + ": " + error);
                    failures++;
                }
            }
            int tokens = 0;
            for (final CardEdition.EditionEntry entry : edition.getTokens().values()) {
                final PaperToken token = StaticData.instance().getAllTokens().getToken(entry.name(), code);
                if (token == null) {
                    System.out.println("FAIL " + code + " no token script: " + entry.name());
                    failures++;
                    continue;
                }
                try {
                    parseAll(CardFactory.getCard(token, owner, game), undefinedKeywords);
                    tokens++;
                } catch (final Throwable error) {
                    System.out.println("FAIL " + code + " token " + entry.name() + ": " + error);
                    failures++;
                }
            }
            int sheetLines = 0;
            for (final Map.Entry<String, List<String>> sheet : customSheets(edition).entrySet()) {
                for (final String line : sheet.getValue()) {
                    if (line.isBlank()) {
                        continue;
                    }
                    sheetLines++;
                    final CardPool pool = CardPool.fromCardList(List.of(line));
                    final PaperCard found = pool.isEmpty() ? null : pool.toFlatList().get(0);
                    final String[] parts = line.split("[|]");
                    if (found == null || parts.length < 2 || !parts[1].trim().equals(found.getEdition())) {
                        System.out.println("FAIL " + code + " sheet [" + sheet.getKey() + "] names no card of its set: \"" + line + "\" gives " + found);
                        failures++;
                    }
                }
            }
            System.out.println(code + ": " + loaded + " of " + names.size() + " cards loaded and parsed, "
                    + tokens + " of " + edition.getTokens().size() + " token entries, " + sheetLines + " custom sheet lines");
        }
        for (final Map.Entry<String, TreeSet<String>> e : undefinedKeywords.entrySet()) {
            System.out.println("non-enum keyword: " + e.getKey() + "  (" + String.join(", ", e.getValue()) + ")");
        }
        System.out.println(failures == 0 ? "PASS TrekCardsLoadCheck" : "FAIL TrekCardsLoadCheck: " + failures);
        System.exit(failures == 0 ? 0 : 1);
    }

    // (each line of the edition's custom booster sheets must name a card of the set it names: CardPool turns a line
    // whose name matches no card into a placeholder with no set, which is what the TRK sheets' eight names with a space
    // before the "|" became, 2026-11-27)
    @SuppressWarnings("unchecked")
    private static Map<String, List<String>> customSheets(final CardEdition edition) {
        try {
            final java.lang.reflect.Field field = CardEdition.class.getDeclaredField("customPrintSheetsToParse");
            field.setAccessible(true);
            return (Map<String, List<String>>) field.get(edition);
        } catch (final ReflectiveOperationException error) {
            throw new IllegalStateException("CardEdition has no customPrintSheetsToParse", error);
        }
    }

    private static void parseAll(final Card card, final Map<String, TreeSet<String>> undefinedKeywords) {
        for (final CardStateName stateName : card.getStates()) {
            final CardState state = card.getState(stateName);
            for (final Map.Entry<String, String> svar : state.getSVars().entrySet()) {
                final String value = svar.getValue().trim();
                if (value.startsWith("DB$") || value.startsWith("AB$") || value.startsWith("SP$")) {
                    try {
                        AbilityFactory.getAbility(value, state);
                    } catch (final RuntimeException error) {
                        throw new RuntimeException("SVar " + svar.getKey() + ": " + error.getMessage(), error);
                    }
                }
            }
            for (final KeywordInterface keyword : state.getCachedKeywords()) {
                if (keyword.getKeyword() == Keyword.UNDEFINED) {
                    undefinedKeywords.computeIfAbsent(keyword.getOriginal(), k -> new TreeSet<>()).add(card.getName());
                }
            }
        }
    }
}
