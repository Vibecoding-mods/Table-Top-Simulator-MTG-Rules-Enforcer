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

    private static String reply(final String status, final String value) {
        final JsonObject r = new JsonObject();
        r.addProperty("status", status);
        r.addProperty("value", value == null ? "" : value);
        return r.toString();
    }
}
