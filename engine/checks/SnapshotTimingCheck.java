package forge.harness.host;

import com.google.gson.JsonObject;
import forge.StaticData;
import forge.ai.LobbyPlayerAi;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.GameRules;
import forge.game.GameStage;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.combat.CombatUtil;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.staticability.StaticAbilityMustAttack;
import forge.game.zone.ZoneType;
import forge.gui.GuiBase;
import forge.harness.common.HeadlessGuiBase;
import forge.item.IPaperCard;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;
import forge.util.collect.FCollectionView;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.Semaphore;
import java.util.concurrent.locks.ReentrantLock;

// Times a snapshot round (one snapshot per seat, as the node sends after each action) on a big 4-player board.
// Uses only what engine1112 already has (reflection on gameLock, actions, pollAction), so the same class times the
// old and the new harness. A stand-in game thread holds the lock and waits in pollAction, as the real one does
// between actions; each round wakes it once. Prints the median and mean ms per round, and a hash of one round's
// four snapshots (the same hash on both harnesses = the same output). First it times the combat-flag work alone both
// ways, interleaved in one process so machine load hits both alike: engine1112's (every seat, a creature's possible
// defenders fetched per creature) and engine1113's (once a round, defenders once per controller).
//   java -cp <harness classes>:<harness jar>:<this class> forge.harness.host.SnapshotTimingCheck [rounds]
public final class SnapshotTimingCheck {
    private static final String[][] CREATURES = {
        {"Grizzly Bears", "8"}, {"Hill Giant", "5"}, {"Wall of Stone", "3"}, {"Bloodrock Cyclops", "3"},
        {"Serra Angel", "5"}, {"Llanowar Elves", "6"},
    };
    private static final String[][] STATICS = {
        {"Propaganda", "Glorious Anthem"}, {"Ghostly Prison", "Crusade"}, {"Silent Arbiter", "Lure"},
        {"Norn's Annex", "Pacifism"},
    };

    public static void main(final String[] args) throws Exception {
        final int rounds = args.length > 0 ? Integer.parseInt(args[0]) : 40;
        GuiBase.setInterface(new HeadlessGuiBase("forge/forge-gui/"));
        FModel.initialize(null, prefs -> {
            prefs.setPref(FPref.LOAD_CARD_SCRIPTS_LAZILY, true);
            prefs.setPref(FPref.UI_LANGUAGE, "en-US");
            return null;
        });
        final ManaBrewInteractiveSession session = new ManaBrewInteractiveSession("snapshot-timing-check");
        final List<RegisteredPlayer> players = new ArrayList<>();
        for (int i = 0; i < 4; i++) {
            players.add(new RegisteredPlayer(new Deck()).setPlayer(new LobbyPlayerAi("P" + i, null)));
        }
        final GameRules rules = new GameRules(GameType.Constructed);
        final Game game = new Game(players, rules, new Match(rules, players, "SnapshotTimingCheck"));
        game.setAge(GameStage.Play);
        game.getPhaseHandler().devModeSet(PhaseType.MAIN1, game.getPlayers().get(0));
        game.getPhaseHandler().onStackResolved();
        int creatures = 0;
        for (int p = 0; p < 4; p++) {
            final Player player = game.getPlayers().get(p);
            for (final String[] c : CREATURES) {
                for (int n = 0; n < Integer.parseInt(c[1]); n++) {
                    add(c[0], player);
                    creatures++;
                }
            }
            for (int n = 0; n < 10; n++) {
                add("Forest", player);
            }
        }
        for (int p = 0; p < 4; p++) {
            for (final String name : STATICS[p]) {
                final Card card = add(name, game.getPlayers().get(p));
                if (card.isAura()) {
                    card.attachToEntity(game.getPlayers().get((p + 1) % 4).getCardsIn(ZoneType.Battlefield).get(0), null, true);
                }
            }
        }
        game.getAction().checkStaticAbilities();
        session.attach(game.getMatch(), game, Set.of(), false);
        System.out.println("board: 4 players, " + creatures + " creatures, "
                + game.getCardsIn(ZoneType.Battlefield).size() + " permanents");

        final List<Card> onBoard = new ArrayList<>();
        for (final Card card : game.getCardsIn(ZoneType.Battlefield)) {
            if (card.isCreature()) {
                onBoard.add(card);
            }
        }
        final long[] perSeat = new long[rounds];
        final long[] perRound = new long[rounds];
        int agree = 0;
        for (int r = -10; r < rounds; r++) {
            long start = System.nanoTime();
            final List<boolean[]> a = new ArrayList<>();
            for (int seat = 0; seat < 4; seat++) {
                a.clear();
                for (final Card card : onBoard) {
                    a.add(flags(card, CombatUtil.getAllPossibleDefenders(card.getController())));
                }
            }
            final long mid = System.nanoTime();
            final Map<Player, FCollectionView<GameEntity>> defenders = new HashMap<>();
            final List<boolean[]> b = new ArrayList<>();
            for (final Card card : onBoard) {
                b.add(flags(card, defenders.computeIfAbsent(card.getController(), CombatUtil::getAllPossibleDefenders)));
            }
            final long end = System.nanoTime();
            if (r >= 0) {
                perSeat[r] = mid - start;
                perRound[r] = end - mid;
                boolean same = true;
                for (int i = 0; i < a.size(); i++) {
                    same &= Arrays.equals(a.get(i), b.get(i));
                }
                agree += same ? 1 : 0;
            }
        }
        System.out.println(String.format("flag work, engine1112 way (every seat, defenders per creature): median %.2f ms per 4 seats",
                median(perSeat)));
        System.out.println(String.format("flag work, engine1113 way (once a round, defenders per controller): median %.2f ms per 4 seats; same flags in %d of %d",
                median(perRound), agree, rounds));

        final long[] alone = time(session, rounds, null);
        System.out.println(String.format("no game thread (each snapshot alone): median %.2f ms, mean %.2f ms per 4 seats",
                median(alone), mean(alone)));

        final ReentrantLock lock = field(session, "gameLock");
        final BlockingQueue<JsonObject> actions = field(session, "actions");
        final Method poll = ManaBrewInteractiveSession.class.getDeclaredMethod("pollAction");
        poll.setAccessible(true);
        final Semaphore waiting = new Semaphore(0);
        final Thread gameThread = new Thread(() -> {
            lock.lock();
            try {
                while (true) {
                    waiting.release();
                    JsonObject action;
                    do {
                        action = (JsonObject) poll.invoke(session);
                    } while (action == null);
                    if ("stop".equals(action.get("kind").getAsString())) {
                        return;
                    }
                }
            } catch (final ReflectiveOperationException e) {
                throw new IllegalStateException(e);
            } finally {
                lock.unlock();
            }
        }, "stand-in game thread");
        gameThread.setDaemon(true);
        gameThread.start();
        waiting.acquire();
        final long[] waited = time(session, rounds, () -> {
            final JsonObject wake = new JsonObject();
            wake.addProperty("kind", "noop");
            actions.offer(wake);
            waiting.acquireUninterruptibly();
        });
        System.out.println(String.format("game thread waiting for an action: median %.2f ms, mean %.2f ms per 4 seats",
                median(waited), mean(waited)));
        System.out.println("round hash " + roundHash(session));
        final JsonObject stop = new JsonObject();
        stop.addProperty("kind", "stop");
        actions.offer(stop);
        gameThread.join(5_000);
        System.out.println("round hash, no game thread " + roundHash(session));
        System.exit(0);
    }

    private static long[] time(final ManaBrewInteractiveSession session, final int rounds, final Runnable between) {
        for (int warm = 0; warm < 10; warm++) {
            round(session);
            if (between != null) {
                between.run();
            }
        }
        final long[] out = new long[rounds];
        for (int r = 0; r < rounds; r++) {
            final long start = System.nanoTime();
            round(session);
            out[r] = System.nanoTime() - start;
            if (between != null) {
                between.run();
            }
        }
        return out;
    }

    private static boolean[] flags(final Card card, final FCollectionView<GameEntity> defenders) {
        boolean cantAttack = !defenders.isEmpty();
        for (final GameEntity defender : defenders) {
            if (CombatUtil.canAttackNextTurn(card, defender)) {
                cantAttack = false;
                break;
            }
        }
        return new boolean[] {!CombatUtil.canBlock(card, true), cantAttack,
            !StaticAbilityMustAttack.entitiesMustAttack(card).isEmpty()};
    }

    private static int round(final ManaBrewInteractiveSession session) {
        int bytes = 0;
        for (int viewer = 0; viewer < 4; viewer++) {
            bytes += session.getSnapshotJson(viewer).length();
        }
        return bytes;
    }

    private static String roundHash(final ManaBrewInteractiveSession session) throws Exception {
        final MessageDigest sha = MessageDigest.getInstance("SHA-256");
        for (int viewer = 0; viewer < 4; viewer++) {
            sha.update(session.getSnapshotJson(viewer).getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
        return HexFormat.of().formatHex(sha.digest()).substring(0, 16);
    }

    private static double median(final long[] nanos) {
        final long[] sorted = nanos.clone();
        Arrays.sort(sorted);
        return sorted[sorted.length / 2] / 1e6;
    }

    private static double mean(final long[] nanos) {
        return Arrays.stream(nanos).average().orElse(0) / 1e6;
    }

    @SuppressWarnings("unchecked")
    private static <T> T field(final Object owner, final String name) throws ReflectiveOperationException {
        final Field field = owner.getClass().getDeclaredField(name);
        field.setAccessible(true);
        return (T) field.get(owner);
    }

    private static Card add(final String name, final Player player) {
        IPaperCard paper = FModel.getMagicDb().getCommonCards().getCard(name);
        if (paper == null) {
            StaticData.instance().attemptToLoadCard(name);
            paper = FModel.getMagicDb().getCommonCards().getCard(name);
        }
        if (paper == null) {
            throw new AssertionError("no card named " + name);
        }
        final Card card = Card.fromPaperCard(paper, player);
        card.setGameTimestamp(player.getGame().getNextTimestamp());
        card.setSickness(false);
        player.getZone(ZoneType.Battlefield).add(card);
        return card;
    }
}
