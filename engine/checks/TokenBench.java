package forge.harness.host;

import forge.StaticData;
import forge.ai.LobbyPlayerAi;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameStage;
import forge.game.GameType;
import forge.game.Match;
import forge.game.ability.AbilityFactory;
import forge.game.ability.AbilityUtils;
import forge.game.card.Card;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.gui.GuiBase;
import forge.harness.common.HeadlessGuiBase;
import forge.item.IPaperCard;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

public final class TokenBench {
    private TokenBench() {}

    public static void main(final String[] args) throws Exception {
        GuiBase.setInterface(new HeadlessGuiBase("forge/forge-gui/"));
        FModel.initialize(null, prefs -> {
            prefs.setPref(FPref.LOAD_CARD_SCRIPTS_LAZILY, true);
            prefs.setPref(FPref.UI_LANGUAGE, "en-US");
            prefs.setPref(FPref.PERFORMANCE_MODE, true);
            return null;
        });
        final boolean doubler = args.length < 1 || !args[0].equals("nodoubler");
        final String mode = args.length > 1 ? args[1] : "sizes";
        if (mode.equals("hot")) {
            final Board b = new Board(doubler);
            b.make(500, "w_1_1_soldier");
            b.make(500, "w_1_1_spirit_flying");
            final Thread main = Thread.currentThread();
            final java.util.Map<String, Integer> incl = new java.util.HashMap<>();
            final int[] n = {0};
            final Thread sampler = new Thread(() -> {
                while (true) {
                    try {
                        Thread.sleep(10);
                    } catch (final InterruptedException e) {
                        return;
                    }
                    n[0]++;
                    final java.util.Set<String> seen = new java.util.HashSet<>();
                    for (final StackTraceElement e : main.getStackTrace()) {
                        if (!e.getClassName().startsWith("forge.game") && !e.getClassName().startsWith("forge.ai")) {
                            continue;
                        }
                        final String k = e.getClassName().replaceAll(".*\\.", "") + "." + e.getMethodName() + ":" + e.getLineNumber();
                        if (seen.add(k)) {
                            incl.merge(k, 1, Integer::sum);
                        }
                    }
                }
            });
            sampler.setDaemon(true);
            sampler.start();
            b.make(Integer.parseInt(args[2]), "w_1_1_human");
            sampler.interrupt();
            System.out.println("samples: " + n[0]);
            incl.entrySet().stream().sorted((x, y) -> y.getValue() - x.getValue()).limit(30)
                    .forEach(e -> System.out.println("  " + e.getValue() + " " + e.getKey()));
        } else if (mode.equals("callers")) {
            final Board b = new Board(doubler);
            final Thread main = Thread.currentThread();
            final java.util.Map<String, Integer> callers = new java.util.HashMap<>();
            final int[] n = {0};
            final Thread sampler = new Thread(() -> {
                while (true) {
                    try {
                        Thread.sleep(5);
                    } catch (final InterruptedException e) {
                        return;
                    }
                    final StackTraceElement[] st = main.getStackTrace();
                    for (int i = 0; i + 1 < st.length; i++) {
                        if (st[i].getMethodName().equals("checkStaticAbilities") && !st[i + 1].getMethodName().equals("checkStaticAbilities")) {
                            final StringBuilder key = new StringBuilder();
                            for (int j = i + 1; j < Math.min(st.length, i + 4); j++) {
                                key.append(st[j].getClassName().replaceAll(".*\\.", "")).append('.').append(st[j].getMethodName()).append(':').append(st[j].getLineNumber()).append(" < ");
                            }
                            callers.merge(key.toString(), 1, Integer::sum);
                            n[0]++;
                            break;
                        }
                    }
                }
            });
            sampler.setDaemon(true);
            sampler.start();
            b.make(Integer.parseInt(args[2]), "w_1_1_soldier");
            sampler.interrupt();
            System.out.println("samples inside checkStaticAbilities: " + n[0]);
            callers.entrySet().stream().sorted((x, y) -> y.getValue() - x.getValue()).limit(14)
                    .forEach(e -> System.out.println("  " + e.getValue() + " " + e.getKey()));
        } else if (mode.equals("sizes")) {
            for (int i = 2; i < args.length; i++) {
                final Board b = new Board(doubler);
                b.make(Integer.parseInt(args[i]), "w_1_1_soldier");
            }
        } else {
            final Board b = new Board(doubler);
            final String[] piles = {"w_1_1_soldier", "w_1_1_spirit_flying", "w_1_1_human", "w_2_2_knight"};
            for (final String pile : piles) {
                b.make(Integer.parseInt(args[2]), pile);
            }
        }
        System.exit(0);
    }

    static final class Board {
        final Game game;
        final Player white;
        final Player blue;
        final boolean doubler;

        Board(final boolean doubler) {
            this.doubler = doubler;
            final List<RegisteredPlayer> players = new ArrayList<>();
            players.add(new RegisteredPlayer(new Deck()).setPlayer(new LobbyPlayerAi("White", null)));
            players.add(new RegisteredPlayer(new Deck()).setPlayer(new LobbyPlayerAi("Blue", null)));
            final GameRules rules = new GameRules(GameType.Constructed);
            game = new Game(players, rules, new Match(rules, players, "TokenBench"));
            game.setAge(GameStage.Play);
            game.getPhaseHandler().devModeSet(PhaseType.MAIN1, game.getPlayers().get(0), 3);
            game.getPhaseHandler().onStackResolved();
            white = game.getPlayers().get(0);
            blue = game.getPlayers().get(1);
            for (final String name : new String[] {"Glorious Anthem", "Intangible Virtue", "Honor of the Pure", "Field Marshal"}) {
                add(name, white);
            }
            if (doubler) {
                add("Anointed Procession", white);
            }
            for (int i = 0; i < 20; i++) {
                add("Grizzly Bears", blue);
                add("Plains", white);
            }
            game.getAction().checkStaticAbilities();
            game.getAction().checkStateEffects(true);
        }

        Card add(final String name, final Player p) {
            IPaperCard paper = FModel.getMagicDb().getCommonCards().getCard(name);
            if (paper == null) {
                StaticData.instance().attemptToLoadCard(name);
                paper = FModel.getMagicDb().getCommonCards().getCard(name);
            }
            final Card card = Card.fromPaperCard(paper, p);
            card.setGameTimestamp(game.getNextTimestamp());
            p.getZone(ZoneType.Battlefield).add(card);
            return card;
        }

        void make(final int tokens, final String script) {
            final int amount = doubler ? tokens / 2 : tokens;
            final Card host = white.getCardsIn(ZoneType.Battlefield).getFirst();
            final SpellAbility sa = AbilityFactory.getAbility("AB$ Token | Cost$ 0 | TokenAmount$ " + amount + " | TokenScript$ " + script + " | TokenOwner$ You", host);
            sa.setActivatingPlayer(white);
            final int before = game.getCardsIn(ZoneType.Battlefield).size();
            final long p0 = game.getAction().getStaticPasses();
            final long t0 = System.nanoTime();
            AbilityUtils.resolve(sa);
            final double ms = (System.nanoTime() - t0) / 1e6;
            final long passes = game.getAction().getStaticPasses() - p0;
            final int made = game.getCardsIn(ZoneType.Battlefield).size() - before;
            final long t1 = System.nanoTime();
            game.getAction().checkStateEffects(true);
            final double sbaMs = (System.nanoTime() - t1) / 1e6;
            System.out.flush();
            System.out.println(String.format(Locale.ROOT, "tokens %s x%d (doubler %s) on %d permanents: made %d, %.0f ms, %.2f ms/token, %d static passes (%.1f/token), state check after %.0f ms",
                    script, amount, doubler, before, made, ms, made == 0 ? 0 : ms / made, passes, made == 0 ? 0 : (double) passes / made, sbaMs));
        }
    }
}
