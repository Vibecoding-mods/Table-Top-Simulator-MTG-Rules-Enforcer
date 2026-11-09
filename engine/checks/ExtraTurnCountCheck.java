package forge.harness.host;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import forge.ai.LobbyPlayerAi;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameStage;
import forge.game.GameType;
import forge.game.Match;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.gui.GuiBase;
import forge.harness.common.HeadlessGuiBase;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.locks.ReentrantLock;

// PlayerDto.extraTurnCount as the snapshot sends it: two extra turns for White give 2, the other seat 0.
//   java -cp <harness jar>:<this class> forge.harness.host.ExtraTurnCountCheck
public final class ExtraTurnCountCheck {
    public static void main(final String[] args) throws Exception {
        GuiBase.setInterface(new HeadlessGuiBase("forge/forge-gui/"));
        FModel.initialize(null, prefs -> {
            prefs.setPref(FPref.LOAD_CARD_SCRIPTS_LAZILY, true);
            prefs.setPref(FPref.UI_LANGUAGE, "en-US");
            return null;
        });
        final ManaBrewInteractiveSession session = new ManaBrewInteractiveSession("extra-turn-count-check");
        final List<RegisteredPlayer> players = new ArrayList<>();
        players.add(new RegisteredPlayer(new Deck()).setPlayer(new ManaBrewInteractiveLobbyPlayer("White", session)));
        players.add(new RegisteredPlayer(new Deck()).setPlayer(new LobbyPlayerAi("AI 1", null)));
        final GameRules rules = new GameRules(GameType.Constructed);
        final Game game = new Game(players, rules, new Match(rules, players, "ExtraTurnCountCheck"));
        game.setAge(GameStage.Play);
        final Player white = game.getPlayers().get(0);
        game.getPhaseHandler().devModeSet(PhaseType.MAIN1, white);
        session.attach(game.getMatch(), game, Set.of(), false);
        final Field lock = ManaBrewInteractiveSession.class.getDeclaredField("gameLock");
        lock.setAccessible(true);
        ((ReentrantLock) lock.get(session)).lock();

        int failed = 0;
        failed += expect(session, "no extra turn", 0, 0);
        game.getPhaseHandler().addExtraTurn(white);
        failed += expect(session, "one extra turn", 1, 0);
        game.getPhaseHandler().addExtraTurn(white);
        failed += expect(session, "two extra turns", 2, 0);
        System.out.println(failed == 0 ? "PASS ExtraTurnCountCheck" : "FAIL ExtraTurnCountCheck: " + failed);
        System.exit(failed == 0 ? 0 : 1);
    }

    private static int expect(final ManaBrewInteractiveSession session, final String what, final int white, final int ai) {
        final JsonObject view = JsonParser.parseString(session.getSnapshotJson(0)).getAsJsonObject();
        final int[] got = new int[2];
        int i = 0;
        for (final JsonElement p : view.getAsJsonArray("players")) {
            got[i++] = p.getAsJsonObject().get("extraTurnCount").getAsInt();
        }
        final boolean ok = got[0] == white && got[1] == ai;
        System.out.println((ok ? "ok " : "FAIL ") + what + ": extraTurnCount " + got[0] + " / " + got[1]);
        return ok ? 0 : 1;
    }
}
