package forge.harness.host;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.nio.charset.StandardCharsets;

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

    private static String reply(final String status, final String value) {
        final JsonObject r = new JsonObject();
        r.addProperty("status", status);
        r.addProperty("value", value == null ? "" : value);
        return r.toString();
    }
}
