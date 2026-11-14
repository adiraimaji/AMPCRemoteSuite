package com.adiraimaji.ampcremote;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

/**
 * Direct command receiver for Tasker, automation apps and adb.
 *
 * adb shell am broadcast -a com.adiraimaji.ampcremote.COMMAND \
 *   -p com.adiraimaji.ampcremote --es cmd next
 */
public class CommandReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        Bundle extras = intent.getExtras();

        String command = first(extras, "cmd", "command");
        String remote = first(extras, "remote");
        String action = first(extras, "action");
        String args = first(extras, "args");
        String value = first(extras, "value", "text");

        if (command.isEmpty() && !remote.isEmpty() && !action.isEmpty()) {
            command = remote + "." + action;
            if (!args.isEmpty()) command += " " + args;
        }
        if (!command.isEmpty() && !value.isEmpty() && !hasWhitespace(command)) {
            String lower = command.toLowerCase();
            boolean takesValue = lower.equals("text") || lower.equals("type") || lower.equals("send")
                    || lower.equals("volume") || lower.equals("open") || lower.equals("launch")
                    || lower.equals("key") || lower.equals("keys") || lower.equals("press")
                    || lower.equals("clipboard") || lower.equals("clip") || lower.equals("browser")
                    || lower.equals("presentation") || lower.equals("power") || lower.equals("window")
                    || lower.equals("media") || lower.equals("pointer");
            if (takesValue) command += " " + value;
        }

        String server = first(extras, "server", "host", "address");
        String token = first(extras, "token");
        String pin = first(extras, "pin");
        String resultAction = first(extras, "resultAction", "result_action");
        String resultPackage = first(extras, "resultPackage", "result_package");
        String requestId = first(extras, "requestId", "request_id");
        boolean quiet = "none".equalsIgnoreCase(resultAction) || "off".equalsIgnoreCase(resultAction);
        if (extras != null && extras.containsKey("broadcast")) {
            quiet = !extras.getBoolean("broadcast", true);
        }

        final Context app = context.getApplicationContext();
        final String commandText = command;
        final boolean quietResult = quiet;
        final PendingResult pending = goAsync();

        new Thread(new Runnable() {
            @Override
            public void run() {
                CommandRunner.Result result;
                try {
                    if (commandText == null || commandText.trim().isEmpty()) {
                        throw new IllegalArgumentException(
                                "No command. Send cmd=next, or remote/action/args extras.");
                    }
                    result = CommandRunner.execute(app, server, token, pin, commandText);
                } catch (Exception error) {
                    result = new CommandRunner.Result();
                    result.ok = false;
                    result.error = error.getMessage() == null ? error.toString() : error.getMessage();
                    result.command = commandText == null ? "" : commandText;
                }
                try {
                    pending.setResultCode(result.ok ? 0 : 1);
                    pending.setResultData(result.toJson().toString());
                } catch (Exception ignored) {
                    // The broadcast may not be ordered.
                }
                if (!quietResult) {
                    TaskerConfig.sendResult(app, result, requestId, resultAction, resultPackage);
                }
                pending.finish();
            }
        }, "ampc-command").start();
    }

    private static String first(Bundle extras, String... names) {
        if (extras == null) return "";
        for (String name : names) {
            Object value = extras.get(name);
            if (value instanceof CharSequence && ((CharSequence) value).length() > 0) {
                return value.toString();
            }
        }
        return "";
    }

    private static boolean hasWhitespace(String text) {
        for (int i = 0; i < text.length(); i++) {
            if (Character.isWhitespace(text.charAt(i))) return true;
        }
        return false;
    }
}
