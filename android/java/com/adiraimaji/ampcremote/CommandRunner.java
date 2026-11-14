package com.adiraimaji.ampcremote;

import android.content.Context;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Resolves a server and runs a command script against it, one line at a time. */
public final class CommandRunner {

    public static class Result {
        public boolean ok;
        public String error = "";
        public Object value;
        public String serverName = "";
        public String serverAddress = "";
        public String command = "";
        public String remote = "";
        public String action = "";
        public boolean pairedNow;
        public JSONArray steps = new JSONArray();
        public long elapsedMs;

        public JSONObject toJson() {
            JSONObject object = new JSONObject();
            try {
                object.put("ok", ok);
                if (ok) {
                    object.put("result", value == null ? JSONObject.NULL : value);
                } else {
                    object.put("error", error == null ? "" : error);
                }
                object.put("server", serverName);
                object.put("address", serverAddress);
                object.put("command", command);
                object.put("remote", remote);
                object.put("action", action);
                object.put("pairedNow", pairedNow);
                if (steps != null && steps.length() > 0) object.put("steps", steps);
                object.put("elapsedMs", elapsedMs);
                object.put("time", System.currentTimeMillis());
            } catch (Exception ignored) {
                // primitives only
            }
            return object;
        }
    }

    private CommandRunner() {
    }

    /**
     * Runs every line of {@code rawCommand} in order. Blank lines and lines
     * starting with # are skipped, "wait"/"waitms" sleep on the phone, and every
     * other line is one API call. Stops at the first failing line.
     */
    public static Result execute(Context context, String serverSpec, String token,
                                 String pin, String rawCommand) throws Exception {
        List<CommandParser.Step> steps = CommandParser.parseScript(rawCommand);

        boolean needsServer = false;
        for (CommandParser.Step step : steps) {
            if (!step.wait) {
                needsServer = true;
                break;
            }
        }

        ServerStore store = ServerStore.get(context);
        ServerInfo server = null;
        if (needsServer) {
            server = store.resolve(serverSpec);
            if (server == null) server = store.defaultServer();
            if (server == null) {
                throw new IllegalStateException("No server is known. Open AM PC Remote and pair with your PC first.");
            }
            if (server.host == null || server.host.isEmpty()) {
                throw new IllegalStateException("The selected server has no address.");
            }
        }

        String usedToken = token == null ? "" : token.trim();
        boolean pairedNow = false;
        if (needsServer) {
            if (usedToken.isEmpty()) usedToken = server.token == null ? "" : server.token;
            if (usedToken.isEmpty()) {
                if (pin == null || pin.trim().isEmpty()) {
                    throw new IllegalStateException(
                            "Not paired with " + server.name + ". Open the app and pair, or add a PIN to this action.");
                }
                ApiClient.PairResult paired = ApiClient.pair(server.host, server.port, pin, deviceName());
                usedToken = paired.token;
                String realName = paired.hello.optString("name", server.name);
                store.setToken(server.host, server.port, usedToken, realName);
                store.setLast(server.host, server.port);
                server.name = realName;
                pairedNow = true;
            }
        }

        boolean script = steps.size() > 1;
        long started = System.currentTimeMillis();
        JSONArray stepResults = new JSONArray();
        List<String> held = new ArrayList<>();
        CommandParser.Command lastCommand = null;
        JSONObject lastResponse = null;

        for (CommandParser.Step step : steps) {
            if (step.wait) {
                if (!sleep(step.waitMs)) {
                    releaseHeld(server, usedToken, held);
                    return failure(step, stepResults, started, script, rawCommand, server,
                            "The wait was interrupted.");
                }
                stepResults.put(stepJson(step, true, null));
                continue;
            }

            JSONObject response;
            try {
                response = ApiClient.action(server.host, server.port, usedToken,
                        step.command.remote, step.command.action, step.command.args);
            } catch (ApiClient.ApiException error) {
                if (error.status == 401 && !pairedNow) {
                    store.clearToken(server.host, server.port);
                    throw new IllegalStateException("The pairing expired. Open AM PC Remote and pair again.");
                }
                releaseHeld(server, usedToken, held);
                return failure(step, stepResults, started, script, rawCommand, server,
                        error.getMessage() == null ? error.toString() : error.getMessage());
            } catch (Exception error) {
                releaseHeld(server, usedToken, held);
                return failure(step, stepResults, started, script, rawCommand, server,
                        error.getMessage() == null ? error.toString() : error.getMessage());
            }

            trackHeld(held, step.command);

            if (step.command.followAction != null && !step.command.followAction.isEmpty()) {
                try {
                    ApiClient.action(server.host, server.port, usedToken,
                            step.command.followRemote, step.command.followAction, step.command.followArgs);
                } catch (Exception error) {
                    releaseHeld(server, usedToken, held);
                    return failure(step, stepResults, started, script, rawCommand, server,
                            error.getMessage() == null ? error.toString() : error.getMessage());
                }
            }

            JSONObject record = stepJson(step, true, null);
            Object value = response.opt("result");
            record.put("result", value == null ? JSONObject.NULL : value);
            stepResults.put(record);
            lastCommand = step.command;
            lastResponse = response;
        }

        if (needsServer) store.setLast(server.host, server.port);

        Result result = new Result();
        result.ok = true;
        result.value = lastResponse == null ? null : lastResponse.opt("result");
        result.serverName = needsServer ? server.name : "";
        result.serverAddress = needsServer ? server.address() : "";
        result.command = script ? steps.size() + " commands" : steps.get(0).describe();
        result.remote = lastCommand == null ? "" : lastCommand.remote;
        result.action = lastCommand == null ? "" : lastCommand.action;
        result.pairedNow = pairedNow;
        result.steps = stepResults;
        result.elapsedMs = System.currentTimeMillis() - started;
        return result;
    }

    /** Remembers which keys a script is holding, so a failure can let go. */
    private static void trackHeld(List<String> held, CommandParser.Command command) {
        if (command == null || !"am.keyboard".equals(command.remote)) return;
        boolean down = "__keydown".equals(command.action);
        if (!down && !"__keyup".equals(command.action)) return;
        JSONArray keys = command.args.optJSONArray("keys");
        if (keys == null) return;
        for (int i = 0; i < keys.length(); i += 1) {
            String combo = normalizeCombo(keys.optString(i));
            if (combo.isEmpty()) continue;
            if (down) {
                if (!held.contains(combo)) held.add(combo);
            } else {
                held.remove(combo);
            }
        }
    }

    /** Best effort: lets go of every key still held when a script fails. */
    private static void releaseHeld(ServerInfo server, String token, List<String> held) {
        if (server == null || held.isEmpty()) return;
        for (int i = held.size() - 1; i >= 0; i -= 1) {
            try {
                JSONArray keys = new JSONArray();
                keys.put(held.get(i));
                JSONObject args = new JSONObject();
                args.put("keys", keys);
                ApiClient.action(server.host, server.port, token, "am.keyboard", "__keyup", args);
            } catch (Exception ignored) {
                // The PC may already be unreachable; nothing else to try.
            }
        }
        held.clear();
    }

    private static String normalizeCombo(String combo) {
        return combo == null ? "" : combo.replace(" ", "").toLowerCase(Locale.US);
    }

    private static JSONObject stepJson(CommandParser.Step step, boolean ok, String error) throws Exception {
        JSONObject record = new JSONObject();
        record.put("line", step.line);
        record.put("command", step.describe());
        record.put("ok", ok);
        if (step.wait) record.put("waitMs", step.waitMs);
        if (error != null) record.put("error", error);
        return record;
    }

    private static Result failure(CommandParser.Step step, JSONArray stepResults, long started,
                                  boolean script, String rawCommand, ServerInfo server,
                                  String message) throws Exception {
        stepResults.put(stepJson(step, false, message));

        Result result = new Result();
        result.ok = false;
        result.error = script ? "Line " + step.line + ": " + message : message;
        result.command = rawCommand == null ? "" : rawCommand.trim();
        result.serverName = server == null ? "" : server.name;
        result.serverAddress = server == null ? "" : server.address();
        result.steps = stepResults;
        result.elapsedMs = System.currentTimeMillis() - started;
        return result;
    }

    /** Sleeps on the caller's background thread. Returns false when interrupted. */
    private static boolean sleep(long ms) {
        if (ms <= 0) return true;
        try {
            Thread.sleep(ms);
            return true;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    public static boolean isReachable(ServerInfo server) {
        if (server == null) return false;
        try {
            JSONObject health = ApiClient.health(server.host, server.port);
            return health.optBoolean("ok", false);
        } catch (Exception ignored) {
            return false;
        }
    }

    public static boolean isPaired(ServerInfo server) {
        return server != null && server.paired();
    }

    public static String deviceName() {
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        String model = Build.MODEL == null ? "" : Build.MODEL.trim();
        String name = (manufacturer + " " + model).trim();
        if (name.isEmpty()) return "Android phone";
        if (name.length() > 50) name = name.substring(0, 50);
        return Character.toUpperCase(name.charAt(0)) + name.substring(1);
    }
}
