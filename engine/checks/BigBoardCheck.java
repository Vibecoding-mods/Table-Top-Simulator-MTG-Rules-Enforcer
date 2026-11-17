package forge.harness.host;

import forge.StaticData;
import forge.ai.ComputerUtilMana;
import forge.ai.LobbyPlayerAi;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameStage;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.combat.Combat;
import forge.game.combat.CombatUtil;
import forge.game.phase.PhaseType;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;
import forge.gui.GuiBase;
import forge.harness.common.ActionSpace;
import forge.harness.common.HeadlessGuiBase;
import forge.item.IPaperCard;
import forge.localinstance.properties.ForgePreferences.FPref;
import forge.model.FModel;

import java.io.IOException;
import java.lang.management.ManagementFactory;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.stream.Stream;

public final class BigBoardCheck {
    private BigBoardCheck() {}

    static final String[] SKIP_TYPES = {"Plane", "Phenomenon", "Scheme", "Conspiracy", "Vanguard", "Dungeon", "Attraction",
        "Contraption", "Planeswalker", "Battle", "Saga", "Aura", "Emblem", "Hero", "Kindred"};

    static final class Pool {
        final List<String> creatures = new ArrayList<>();
        final List<String> lands = new ArrayList<>();
        final List<String> others = new ArrayList<>();
    }

    public static void main(final String[] args) throws Exception {
        GuiBase.setInterface(new HeadlessGuiBase("forge/forge-gui/"));
        FModel.initialize(null, prefs -> {
            prefs.setPref(FPref.LOAD_CARD_SCRIPTS_LAZILY, true);
            prefs.setPref(FPref.UI_LANGUAGE, "en-US");
            prefs.setPref(FPref.PERFORMANCE_MODE, true);
            return null;
        });
        final String mode = args.length > 0 ? args[0] : "decisions";
        final Pool pool = pool();
        System.out.println("pool creatures=" + pool.creatures.size() + " lands=" + pool.lands.size() + " others=" + pool.others.size());
        if (mode.equals("decisions")) {
            final int seats = args.length > 2 ? Integer.parseInt(args[2]) : 6;
            final int[] sizes = parse(args.length > 1 ? args[1] : "10,20,40,60");
            decisions(pool, seats, 10, true);
            for (final int n : sizes) {
                decisions(pool, seats, n, false);
            }
        } else if (mode.equals("sample")) {
            sample(pool, args.length > 1 ? args[1] : "actions", args.length > 2 ? Integer.parseInt(args[2]) : 60);
        } else if (mode.equals("checkpoints")) {
            final int seats = args.length > 1 ? Integer.parseInt(args[1]) : 4;
            final int perSeat = args.length > 2 ? Integer.parseInt(args[2]) : 125;
            final int library = args.length > 3 ? Integer.parseInt(args[3]) : 0;
            final int count = args.length > 4 ? Integer.parseInt(args[4]) : 40;
            checkpoints(pool, seats, perSeat, library, count);
        }
        System.exit(0);
    }

    static int[] parse(final String list) {
        final String[] parts = list.split(",");
        final int[] out = new int[parts.length];
        for (int i = 0; i < parts.length; i++) {
            out[i] = Integer.parseInt(parts[i].trim());
        }
        return out;
    }

    static Pool pool() throws IOException {
        final Pool pool = new Pool();
        final List<String[]> rows = new ArrayList<>();
        try (Stream<Path> files = Files.walk(Path.of("forge/forge-gui/res/cardsfolder"))) {
            for (final Path f : (Iterable<Path>) files.filter(p -> p.toString().endsWith(".txt")).sorted()::iterator) {
                String name = null;
                String types = null;
                boolean alt = false;
                for (final String line : Files.readAllLines(f, StandardCharsets.UTF_8)) {
                    if (line.startsWith("Name:") && name == null) {
                        name = line.substring(5).trim();
                    } else if (line.startsWith("Types:") && types == null) {
                        types = line.substring(6).trim();
                    } else if (line.startsWith("AlternateMode") || line.startsWith("ALTERNATE")) {
                        alt = true;
                    } else if ((line.contains("Mode$ CantAttack |") || line.contains("Mode$ CantBlock |") || line.contains("Mode$ CantAttack$"))
                            && !line.contains("ValidCard$ Card.Self")) {
                        alt = true;
                    }
                }
                if (name == null || types == null || alt || name.startsWith("A-") || name.contains("\"")) {
                    continue;
                }
                rows.add(new String[] {name, types});
            }
        }
        rows.sort(Comparator.comparing(r -> hash(r[0])));
        for (final String[] r : rows) {
            final List<String> t = List.of(r[1].split(" "));
            boolean skip = false;
            for (final String s : SKIP_TYPES) {
                if (t.contains(s)) {
                    skip = true;
                }
            }
            if (skip) {
                continue;
            }
            if (t.contains("Creature")) {
                pool.creatures.add(r[0]);
            } else if (t.contains("Land") && !t.contains("Basic")) {
                pool.lands.add(r[0]);
            } else if (t.contains("Artifact") || t.contains("Enchantment")) {
                pool.others.add(r[0]);
            }
        }
        return pool;
    }

    static String hash(final String s) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-1").digest(s.getBytes(StandardCharsets.UTF_8)));
        } catch (final Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static Card add(final String name, final Player p, final ZoneType zone) {
        IPaperCard paper = FModel.getMagicDb().getCommonCards().getCard(name);
        if (paper == null) {
            StaticData.instance().attemptToLoadCard(name);
            paper = FModel.getMagicDb().getCommonCards().getCard(name);
        }
        if (paper == null) {
            return null;
        }
        final Card card = Card.fromPaperCard(paper, p);
        card.setGameTimestamp(p.getGame().getNextTimestamp());
        p.getZone(zone).add(card);
        return card;
    }

    static String next(final List<String> list, final int[] at, final Player p, final ZoneType zone, final List<Card> out) {
        while (at[0] < list.size()) {
            final String name = list.get(at[0]++);
            try {
                final Card c = add(name, p, zone);
                if (c != null) {
                    out.add(c);
                    return name;
                }
            } catch (final RuntimeException ignored) {
            }
        }
        throw new IllegalStateException("the pool ran out");
    }

    static final class Table {
        final ManaBrewInteractiveSession session = new ManaBrewInteractiveSession("big-board");
        final Game game;
        final List<Player> players = new ArrayList<>();
        int permanents;
        int creatures;

        Table(final Pool pool, final int seats, final int perSeat, final int library, final boolean recording) {
            final List<RegisteredPlayer> regs = new ArrayList<>();
            final String[] names = {"White", "Red", "Yellow", "Green", "Blue", "Purple"};
            for (int i = 0; i < seats; i++) {
                regs.add(new RegisteredPlayer(new Deck()).setPlayer(new LobbyPlayerAi(names[i], null)));
            }
            final GameRules rules = new GameRules(GameType.Constructed);
            rules.setSimTimeout(120);
            rules.setRenderAbilityText(false);
            game = new Game(regs, rules, new Match(rules, regs, "BigBoardCheck"));
            game.setAge(GameStage.Play);
            game.getPhaseHandler().devModeSet(PhaseType.MAIN1, game.getPlayers().get(0), 5);
            game.getPhaseHandler().onStackResolved();
            players.addAll(game.getPlayers());
            final int[] ci = {0};
            final int[] li = {0};
            final int[] oi = {0};
            final int nLands = Math.round(perSeat * 0.37f);
            final int nCreatures = Math.round(perSeat * 0.42f);
            final int nOthers = perSeat - nLands - nCreatures;
            for (final Player p : players) {
                final List<Card> placed = new ArrayList<>();
                for (int i = 0; i < nLands; i++) {
                    next(pool.lands, li, p, ZoneType.Battlefield, placed);
                }
                for (int i = 0; i < nCreatures; i++) {
                    next(pool.creatures, ci, p, ZoneType.Battlefield, placed);
                }
                for (int i = 0; i < nOthers; i++) {
                    next(pool.others, oi, p, ZoneType.Battlefield, placed);
                }
                for (final Card c : placed) {
                    c.setSickness(false);
                }
                for (int i = 0; i < library; i++) {
                    next(pool.creatures, ci, p, i % 10 < 7 ? ZoneType.Library : i % 10 < 9 ? ZoneType.Graveyard : ZoneType.Hand, new ArrayList<>());
                }
                p.setLife(20, null);
                permanents += placed.size();
            }
            game.getAction().checkStaticAbilities();
            game.getAction().checkStateEffects(true);
            for (final Player p : players) {
                creatures += p.getCreaturesInPlay().size();
            }
            session.attach(game.getMatch(), game, Set.of(), recording);
        }
    }

    static double ms(final long t0) {
        return (System.nanoTime() - t0) / 1_000_000.0;
    }

    static void decisions(final Pool pool, final int seats, final int perSeat, final boolean warmUp) {
        final Table t = new Table(pool, seats, perSeat, 0, false);
        final Game game = t.game;
        final Player active = t.players.get(0);
        final Map<String, Object> row = new LinkedHashMap<>();
        row.put("seats", seats);
        row.put("perSeat", perSeat);
        row.put("permanents", t.permanents);
        row.put("creatures", t.creatures);
        long t0 = System.nanoTime();
        for (int i = 0; i < 3; i++) {
            game.getAction().checkStateEffects(true);
        }
        row.put("stateCheckMs", ms(t0) / 3);
        t0 = System.nanoTime();
        for (int i = 0; i < 3; i++) {
            game.getAction().checkStaticAbilities();
        }
        row.put("staticsMs", ms(t0) / 3);
        t0 = System.nanoTime();
        final List<SpellAbility> actions = ActionSpace.getPossibleActions(active, true, true);
        row.put("actionsMs", ms(t0));
        row.put("actions", actions.size());
        t0 = System.nanoTime();
        t.session.getSnapshotJson(0);
        row.put("snapshotMs", ms(t0));
        final Card gnomes = add("Bottle Gnomes", active, ZoneType.Hand);
        final SpellAbility small = gnomes.getFirstSpellAbility();
        small.setActivatingPlayer(active);
        long g0 = System.nanoTime();
        final boolean canSmall = ComputerUtilMana.canPayManaCost(small, active, 0, false);
        row.put("canPay3Ms", ms(g0));
        row.put("canPay3", canSmall);
        final Card spell = add("Ulamog's Crusher", active, ZoneType.Hand);
        final SpellAbility sa = spell.getFirstSpellAbility();
        sa.setActivatingPlayer(active);
        t0 = System.nanoTime();
        final boolean can = ComputerUtilMana.canPayManaCost(sa, active, 0, false);
        row.put("canPayMs", ms(t0));
        row.put("canPay", can);
        game.getPhaseHandler().devModeSet(PhaseType.COMBAT_DECLARE_ATTACKERS, active, 5);
        final Combat combat = new Combat(active);
        game.getPhaseHandler().setCombat(combat);
        t0 = System.nanoTime();
        active.getController().declareAttackers(active, combat);
        row.put("aiAttackMs", ms(t0));
        row.put("aiAttackers", combat.getAttackers().size());
        int forced = 0;
        if (combat.getAttackers().size() < 5) {
            final List<Player> defenders = new ArrayList<>(t.players.subList(1, t.players.size()));
            int k = 0;
            for (final Card c : active.getCreaturesInPlay()) {
                final Player d = defenders.get(k % defenders.size());
                if (!combat.isAttacking(c) && CombatUtil.canAttack(c, d)) {
                    combat.addAttacker(c, d);
                    forced++;
                    k++;
                }
            }
        }
        row.put("forcedAttackers", forced);
        double maxBlock = 0;
        double sumBlock = 0;
        int blockers = 0;
        for (final Player d : t.players.subList(1, t.players.size())) {
            if (combat.getAttackersOf(d).isEmpty()) {
                continue;
            }
            d.setLife(Math.max(1, Math.min(d.getLife(), 6)), null);
            final long b0 = System.nanoTime();
            d.getController().declareBlockers(d, combat);
            final double ms = ms(b0);
            maxBlock = Math.max(maxBlock, ms);
            sumBlock += ms;
        }
        blockers = combat.getAllBlockers().size();
        row.put("aiBlockMaxMs", maxBlock);
        row.put("aiBlockAllMs", sumBlock);
        row.put("blockers", blockers);
        game.getPhaseHandler().devModeSet(PhaseType.MAIN2, active, 5);
        game.getPhaseHandler().setCombat(null);
        t0 = System.nanoTime();
        final boolean paid = can && ComputerUtilMana.payManaCost(sa.getPayCosts(), active, sa, false);
        row.put("aiPay8Ms", ms(t0));
        row.put("paid8", paid);
        g0 = System.nanoTime();
        final boolean paidSmall = canSmall && ComputerUtilMana.payManaCost(small.getPayCosts(), active, small, false);
        row.put("aiPay3Ms", ms(g0));
        row.put("paid3", paidSmall);
        System.out.println((warmUp ? "warmup " : "row ") + row);
    }

    static void sample(final Pool pool, final String what, final int perSeat) {
        final Table t = new Table(pool, 6, perSeat, 0, false);
        final Player act = t.players.get(0);
        final SpellAbility sa = add("Ulamog's Crusher", act, ZoneType.Hand).getFirstSpellAbility();
        sa.setActivatingPlayer(act);
        if (what.equals("actions")) {
            ActionSpace.getPossibleActions(act, true, true);
        }
        final Combat combat = new Combat(act);
        if (what.equals("attack")) {
            act.getGame().getPhaseHandler().devModeSet(PhaseType.COMBAT_DECLARE_ATTACKERS, act, 5);
            act.getGame().getPhaseHandler().setCombat(combat);
        }
        final Thread main = Thread.currentThread();
        final Map<String, Integer> incl = new java.util.HashMap<>();
        final Map<String, Integer> self = new java.util.HashMap<>();
        final int[] n = {0};
        final Thread sampler = new Thread(() -> {
            while (true) {
                try {
                    Thread.sleep(20);
                } catch (final InterruptedException e) {
                    return;
                }
                n[0]++;
                final java.util.Set<String> seen = new java.util.HashSet<>();
                String first = null;
                for (final StackTraceElement e : main.getStackTrace()) {
                    if (!e.getClassName().startsWith("forge.") || e.getClassName().endsWith("BigBoardCheck")) {
                        continue;
                    }
                    final String k = e.getClassName().replaceAll(".*\\.", "") + "." + e.getMethodName();
                    if (first == null) {
                        first = k;
                    }
                    if (seen.add(k)) {
                        incl.merge(k, 1, Integer::sum);
                    }
                }
                if (first != null) {
                    self.merge(first, 1, Integer::sum);
                }
            }
        });
        sampler.setDaemon(true);
        sampler.start();
        final long t0 = System.nanoTime();
        if (what.equals("actions")) {
            ActionSpace.getPossibleActions(act, true, true);
        } else if (what.equals("attack")) {
            act.getController().declareAttackers(act, combat);
        } else {
            ComputerUtilMana.payManaCost(sa.getPayCosts(), act, sa, false);
        }
        final double took = ms(t0);
        sampler.interrupt();
        System.out.println("sample " + what + " perSeat=" + perSeat + " ms=" + took + " samples=" + n[0]);
        incl.entrySet().stream().sorted((x, y) -> y.getValue() - x.getValue()).limit(25)
                .forEach(e -> System.out.println("  incl " + e.getValue() + " " + e.getKey()));
        self.entrySet().stream().sorted((x, y) -> y.getValue() - x.getValue()).limit(5)
                .forEach(e -> System.out.println("  self " + e.getValue() + " " + e.getKey()));
    }

    static long used() {
        for (int i = 0; i < 4; i++) {
            System.gc();
            try {
                Thread.sleep(150);
            } catch (final InterruptedException ignored) {
            }
        }
        return ManagementFactory.getMemoryMXBean().getHeapMemoryUsage().getUsed();
    }

    static void checkpoints(final Pool pool, final int seats, final int perSeat, final int library, final int count) throws Exception {
        final long before = used();
        final Table t = new Table(pool, seats, perSeat, library, true);
        int cards = 0;
        for (final Player p : t.players) {
            for (final ZoneType z : new ZoneType[] {ZoneType.Battlefield, ZoneType.Library, ZoneType.Hand, ZoneType.Graveyard}) {
                cards += p.getCardsIn(z).size();
            }
        }
        int resolved = 0;
        for (int k = 0; k < 200; k++) {
            t.game.getStack().addAllTriggeredAbilitiesToStack();
            if (t.game.getStack().isEmpty() && !t.game.getStack().hasSimultaneousStackEntries()) {
                break;
            }
            t.game.getStack().resolveStack();
            t.game.getAction().checkStateEffects(true);
            resolved++;
        }
        t.session.enableCheckpointMetrics();
        final long game = used();
        final Method record = ManaBrewInteractiveSession.class.getDeclaredMethod("recordCheckpoint");
        record.setAccessible(true);
        final Field turn = ManaBrewInteractiveSession.class.getDeclaredField("checkpointTurn");
        turn.setAccessible(true);
        final Field deque = ManaBrewInteractiveSession.class.getDeclaredField("checkpoints");
        deque.setAccessible(true);
        final List<Double> copies = new ArrayList<>();
        final List<Double> adds = new ArrayList<>();
        final List<Long> heaps = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            turn.setInt(t.session, -1 - i);
            record.invoke(t.session);
            final String json = t.session.drainCheckpointMetrics();
            for (final String part : json.replace("[", "").replace("]", " ").trim().split("\\s+")) {
                if (part.isBlank()) {
                    continue;
                }
                final String[] ns = part.replaceAll("^,", "").split(",");
                copies.add(Long.parseLong(ns[0].trim()) / 1_000_000.0);
                adds.add(Long.parseLong(ns[1].trim()) / 1_000_000.0);
            }
            if (i == 0 || i == 9 || i == count - 1) {
                heaps.add(used());
            }
        }
        final long after = used();
        final int kept = ((java.util.Collection<?>) deque.get(t.session)).size();
        copies.sort(Double::compare);
        final Map<String, Object> row = new LinkedHashMap<>();
        row.put("seats", seats);
        row.put("cardsInZones", cards);
        row.put("permanents", t.permanents);
        row.put("checkpointsKept", kept);
        row.put("triggersResolvedFirst", resolved);
        row.put("stackEmpty", t.game.getStack().isEmpty());
        row.put("baseHeapMB", before / 1048576.0);
        row.put("gameHeapMB", (game - before) / 1048576.0);
        row.put("checkpointsHeapMB", (after - game) / 1048576.0);
        row.put("perCheckpointMB", (after - game) / 1048576.0 / Math.max(1, kept));
        row.put("heapAt1/10/lastMB", heaps.stream().map(h -> String.format(Locale.ROOT, "%.0f", h / 1048576.0)).toList());
        row.put("totalHeapUsedMB", after / 1048576.0);
        row.put("maxHeapMB", Runtime.getRuntime().maxMemory() / 1048576.0);
        row.put("makeCopyMsMedian", copies.isEmpty() ? null : copies.get(copies.size() / 2));
        row.put("makeCopyMsMax", copies.isEmpty() ? null : copies.get(copies.size() - 1));
        row.put("addAndPublishMsMedian", adds.isEmpty() ? null : adds.stream().sorted().toList().get(adds.size() / 2));
        System.out.println("row " + row);
    }
}
