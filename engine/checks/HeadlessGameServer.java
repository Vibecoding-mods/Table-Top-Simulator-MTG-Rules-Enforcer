package forge.harness.host;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

public final class HeadlessGameServer {
    private HeadlessGameServer() {}

    public static void main(final String[] args) throws Exception {
        final PrintStream out = new PrintStream(new java.io.FileOutputStream(java.io.FileDescriptor.out), true, StandardCharsets.UTF_8);
        System.setOut(new PrintStream(System.err, true, StandardCharsets.UTF_8));
        final ManaBrewEngineAdapter adapter = new ManaBrewEngineAdapter();
        adapter.initialize(args.length > 0 ? args[0] : "forge/forge-gui/");
        final BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        String session = null;
        out.println(reply("ready", ""));
        String line;
        while ((line = in.readLine()) != null) {
            final int space = line.indexOf(' ');
            final String cmd = space < 0 ? line : line.substring(0, space);
            final String rest = space < 0 ? "" : line.substring(space + 1);
            try {
                switch (cmd) {
                    case "start": {
                        final JsonObject handle = JsonParser.parseString(adapter.startGameJson(rest)).getAsJsonObject();
                        session = handle.get("sessionId").getAsString();
                        out.println(reply("ok", handle.toString()));
                        break;
                    }
                    case "prompt":
                        out.println(reply("ok", adapter.getPrompt(session, 0)));
                        break;
                    case "snapshot":
                        out.println(reply("ok", adapter.getSnapshot(session, Integer.parseInt(rest.trim()))));
                        break;
                    case "submit":
                        out.println(reply("ok", adapter.submitAction(session, rest)));
                        break;
                    case "over":
                        out.println(reply("ok", adapter.getGameOver(session)));
                        break;
                    case "revision":
                        out.println(reply("ok", adapter.getStateRevision(session)));
                        break;
                    case "error":
                        out.println(reply("ok", adapter.getEngineError(session)));
                        break;
                    case "end":
                        if (session != null) {
                            adapter.endGame(session);
                        }
                        session = null;
                        out.println(reply("ok", ""));
                        break;
                    case "profile":
                        out.println(reply("ok", Sampler.dumpAndReset()));
                        break;
                    case "heap":
                        out.println(reply("ok", Retainers.heapAfterGc()));
                        break;
                    case "retainers":
                        out.println(reply("ok", Retainers.walk(adapter, rest.isBlank() ? 25 : Integer.parseInt(rest.trim()))));
                        break;
                    case "quit":
                        out.println(reply("ok", ""));
                        System.exit(0);
                        break;
                    default:
                        out.println(reply("error", "unknown command " + cmd));
                }
            } catch (final RuntimeException error) {
                final java.io.StringWriter trace = new java.io.StringWriter();
                error.printStackTrace(new java.io.PrintWriter(trace));
                out.println(reply("error", trace.toString()));
            }
        }
        System.exit(0);
    }

    // "profile": where the game thread ("mana-brew-forge-*") spent its time since the last "profile", sampled every
    // 2 ms (tools/kykar-loop-bench.js). Buckets: idle (waiting for an answer), ai (any forge.ai frame), harness:<the
    // innermost harness method> (prompt building and the like), forge:resolve / forge:stateEffects / forge:other;
    // "top" is the innermost non-JDK frames of the busy samples.
    static final class Sampler {
        private static final java.util.Map<String, Integer> BUCKETS = new java.util.HashMap<>();
        private static final java.util.Map<String, Integer> TOP = new java.util.HashMap<>();
        private static int samples;

        static {
            final Thread t = new Thread(Sampler::run, "game-thread-sampler");
            t.setDaemon(true);
            t.start();
        }

        private static void run() {
            Thread game = null;
            while (true) {
                try {
                    Thread.sleep(2);
                } catch (final InterruptedException e) {
                    return;
                }
                if (game == null || !game.isAlive()) {
                    game = null;
                    for (final Thread t : Thread.getAllStackTraces().keySet()) {
                        if (t.getName().startsWith("mana-brew-forge-")) {
                            game = t;
                        }
                    }
                    if (game == null) {
                        continue;
                    }
                }
                final Thread.State state = game.getState();
                final StackTraceElement[] st = game.getStackTrace();
                synchronized (BUCKETS) {
                    samples++;
                    final String bucket = state == Thread.State.RUNNABLE ? bucket(st) : "idle";
                    BUCKETS.merge(bucket, 1, Integer::sum);
                    if (!"idle".equals(bucket)) {
                        for (final StackTraceElement e : st) {
                            if (!e.getClassName().startsWith("java.") && !e.getClassName().startsWith("jdk.")
                                    && !e.getClassName().startsWith("sun.") && !e.getClassName().startsWith("com.google.")) {
                                TOP.merge(bucket + " " + e.getClassName() + "." + e.getMethodName(), 1, Integer::sum);
                                break;
                            }
                        }
                    }
                }
            }
        }

        private static String bucket(final StackTraceElement[] st) {
            for (final StackTraceElement e : st) {
                if (e.getClassName().startsWith("forge.ai.")) {
                    return "ai";
                }
            }
            final List<String> harness = new ArrayList<>();
            for (int i = st.length - 1; i >= 0; i--) {
                final String c = st[i].getClassName();
                if (c.startsWith("forge.harness.") && !"runMatch".equals(st[i].getMethodName()) && !c.contains("$$Lambda")
                        && !st[i].getMethodName().startsWith("lambda$")) {
                    final String m = c.substring(c.lastIndexOf('.') + 1) + "." + st[i].getMethodName();
                    if (harness.isEmpty() || !harness.get(harness.size() - 1).equals(m)) {
                        harness.add(m);
                    }
                }
            }
            if (!harness.isEmpty()) {
                return "harness:" + String.join(" > ", harness.subList(0, Math.min(3, harness.size())))
                        + (harness.size() > 3 ? " .. " + harness.get(harness.size() - 1) : "");
            }
            for (final StackTraceElement e : st) {
                if (e.getClassName().endsWith("MagicStack") && "resolveStack".equals(e.getMethodName())) {
                    return "forge:resolve";
                }
                if ("checkStateEffects".equals(e.getMethodName()) || "checkStaticAbilities".equals(e.getMethodName())) {
                    return "forge:stateEffects";
                }
            }
            return "forge:other";
        }

        static String dumpAndReset() {
            final JsonObject o = new JsonObject();
            synchronized (BUCKETS) {
                o.addProperty("samples", samples);
                final JsonObject b = new JsonObject();
                BUCKETS.forEach(b::addProperty);
                o.add("buckets", b);
                final JsonObject top = new JsonObject();
                TOP.entrySet().stream().sorted((x, y) -> y.getValue() - x.getValue()).limit(40)
                        .forEach(e -> top.addProperty(e.getKey(), e.getValue()));
                o.add("top", top);
                BUCKETS.clear();
                TOP.clear();
                samples = 0;
            }
            return o.toString();
        }
    }

    // "heap": the heap in use after a System.gc(), in MB. "retainers [n]": a breadth-first walk of everything the
    // adapter reaches (instance fields by reflection, JDK collections through their API, the card database left out);
    // every Card reached that is not one of the live game's cards is counted by the path it was first reached on
    // (class.field steps, indices dropped), and the n most common paths are listed. Finds what keeps copies alive.
    static final class Retainers {
        static String heapAfterGc() {
            final Runtime rt = Runtime.getRuntime();
            System.gc();
            final JsonObject o = new JsonObject();
            o.addProperty("usedMb", (rt.totalMemory() - rt.freeMemory()) / 1048576.0);
            o.addProperty("maxMb", rt.maxMemory() / 1048576.0);
            return o.toString();
        }

        private static boolean skipped(final Class<?> c) {
            final String n = c.getName();
            return n.startsWith("forge.card.") || n.startsWith("forge.item.") || n.equals("forge.StaticData")
                    || n.startsWith("forge.localinstance.") || n.startsWith("forge.itemmanager.")
                    || n.startsWith("forge.gui.") || n.startsWith("forge.util.Localizer")
                    || Thread.class.isAssignableFrom(c) || ClassLoader.class.isAssignableFrom(c) || c == Class.class
                    || n.startsWith("java.lang.reflect.") || n.startsWith("java.lang.invoke.")
                    || n.startsWith("java.util.concurrent.locks.") || n.startsWith("java.io.") || n.startsWith("java.nio.")
                    || n.startsWith("sun.") || n.startsWith("jdk.") || n.startsWith("org.tinylog.");
        }

        static String walk(final Object root, final int top) {
            final java.util.IdentityHashMap<Object, String> seen = new java.util.IdentityHashMap<>();
            final java.util.IdentityHashMap<Object, Object> parent = new java.util.IdentityHashMap<>();
            final java.util.ArrayDeque<Object> queue = new java.util.ArrayDeque<>();
            seen.put(root, "root");
            queue.add(root);
            forge.game.Game live = null;
            final List<forge.game.card.Card> cards = new ArrayList<>();
            final java.util.Map<String, Integer> byClass = new java.util.HashMap<>();
            while (!queue.isEmpty()) {
                final Object o = queue.poll();
                final Class<?> c = o.getClass();
                if (o instanceof forge.game.card.Card card) {
                    cards.add(card);
                }
                if (live == null && o instanceof ManaBrewInteractiveSession s) {
                    try {
                        final java.lang.reflect.Field f = ManaBrewInteractiveSession.class.getDeclaredField("game");
                        f.setAccessible(true);
                        live = (forge.game.Game) f.get(s);
                    } catch (final ReflectiveOperationException ignored) {
                    }
                }
                byClass.merge(c.getName(), 1, Integer::sum);
                final List<Object[]> kids = new ArrayList<>();
                if (c.isArray()) {
                    if (!c.getComponentType().isPrimitive()) {
                        for (final Object k : (Object[]) o) {
                            kids.add(new Object[] { k, "[]" });
                        }
                    }
                } else if (c.getName().startsWith("java.") || c.getName().startsWith("javax.")) {
                    try {
                        if (o instanceof java.util.Map<?, ?> m) {
                            for (final java.util.Map.Entry<?, ?> e : new ArrayList<>(m.entrySet())) {
                                kids.add(new Object[] { e.getKey(), "{k}" });
                                kids.add(new Object[] { e.getValue(), "{v}" });
                            }
                        } else if (o instanceof Iterable<?> it) {
                            final List<Object> copy = new ArrayList<>();
                            for (final Object k : it) {
                                copy.add(k);
                            }
                            for (final Object k : copy) {
                                kids.add(new Object[] { k, "[]" });
                            }
                        } else if (o instanceof java.util.Optional<?> opt && opt.isPresent()) {
                            kids.add(new Object[] { opt.get(), ".get" });
                        } else if (o instanceof java.util.concurrent.atomic.AtomicReference<?> ref) {
                            kids.add(new Object[] { ref.get(), ".get" });
                        }
                    } catch (final RuntimeException ignored) {
                    }
                } else {
                    for (Class<?> k = c; k != null && k != Object.class; k = k.getSuperclass()) {
                        if (k.getName().startsWith("java.")) {
                            break;
                        }
                        for (final java.lang.reflect.Field f : k.getDeclaredFields()) {
                            if (java.lang.reflect.Modifier.isStatic(f.getModifiers()) || f.getType().isPrimitive()) {
                                continue;
                            }
                            try {
                                f.setAccessible(true);
                                kids.add(new Object[] { f.get(o), k.getSimpleName() + "." + f.getName() });
                            } catch (final RuntimeException | IllegalAccessException ignored) {
                            }
                        }
                    }
                }
                for (final Object[] kid : kids) {
                    final Object k = kid[0];
                    if (k == null || seen.containsKey(k) || skipped(k.getClass()) || k instanceof String
                            || k instanceof Number || k instanceof Boolean || k instanceof Enum<?>) {
                        continue;
                    }
                    seen.put(k, (String) kid[1]);
                    parent.put(k, o);
                    queue.add(k);
                }
            }
            final java.util.Set<forge.game.card.Card> liveCards = java.util.Collections.newSetFromMap(new java.util.IdentityHashMap<>());
            if (live != null) {
                for (final forge.game.card.Card c : live.getCardsInGame()) {
                    liveCards.add(c);
                }
            }
            final java.util.Map<String, Integer> paths = new java.util.HashMap<>();
            int other = 0;
            for (final forge.game.card.Card card : cards) {
                if (liveCards.contains(card)) {
                    continue;
                }
                other++;
                final List<String> steps = new ArrayList<>();
                Object at = card;
                while (at != null && steps.size() < 400) {
                    final String edge = seen.get(at);
                    final Object up = parent.get(at);
                    if (up == null) {
                        break;
                    }
                    steps.add(up.getClass().getSimpleName() + edge.replaceAll("^[^.\\[{]*", ""));
                    at = up;
                }
                java.util.Collections.reverse(steps);
                final List<String> squeezed = new ArrayList<>();
                for (final String s : steps) {
                    if (squeezed.isEmpty() || !squeezed.get(squeezed.size() - 1).equals(s)) {
                        squeezed.add(s);
                    }
                }
                paths.merge(String.join(" > ", squeezed.subList(Math.max(0, squeezed.size() - 14), squeezed.size()))
                        + (card.getGame() == live ? " [live game]" : " [other game]") + (card.isLKI() ? " LKI" : ""), 1, Integer::sum);
            }
            final JsonObject o = new JsonObject();
            o.addProperty("objects", seen.size());
            o.addProperty("cards", cards.size());
            o.addProperty("liveCards", liveCards.size());
            o.addProperty("otherCards", other);
            final JsonObject p = new JsonObject();
            paths.entrySet().stream().sorted((x, y) -> y.getValue() - x.getValue()).limit(top)
                    .forEach(e -> p.addProperty(e.getKey(), e.getValue()));
            o.add("paths", p);
            final JsonObject cl = new JsonObject();
            byClass.entrySet().stream().sorted((x, y) -> y.getValue() - x.getValue()).limit(30)
                    .forEach(e -> cl.addProperty(e.getKey(), e.getValue()));
            o.add("classes", cl);
            return o.toString();
        }
    }

    private static String reply(final String status, final String value) {
        final JsonObject r = new JsonObject();
        r.addProperty("status", status);
        r.addProperty("value", value == null ? "" : value);
        return r.toString();
    }
}
