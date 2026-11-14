package com.adiraimaji.ampcremote;

import android.content.Context;
import android.content.Intent;

import org.json.JSONObject;

/** Constants shared by the Tasker plugin and the direct broadcast API. */
public final class TaskerConfig {
    public static final String ACTION_EDIT = "com.twofortyfouram.locale.intent.action.EDIT_SETTING";
    public static final String ACTION_FIRE = "com.twofortyfouram.locale.intent.action.FIRE_SETTING";
    public static final String ACTION_QUERY = "com.twofortyfouram.locale.intent.action.QUERY_CONDITION";

    public static final String EXTRA_BUNDLE = "com.twofortyfouram.locale.intent.extra.BUNDLE";
    public static final String EXTRA_STRING_BLURB = "com.twofortyfouram.locale.intent.extra.STRING_BLURB";

    public static final String KEY_MODE = "mode";
    public static final String KEY_COMMAND = "command";
    public static final String KEY_SERVER = "server";
    public static final String KEY_PIN = "pin";
    public static final String KEY_TOKEN = "token";
    public static final String KEY_STATE = "state";
    public static final String KEY_BROADCAST = "broadcast";
    public static final String KEY_RESULT_ACTION = "resultAction";

    public static final String MODE_ACTION = "action";
    public static final String MODE_CONDITION = "condition";

    public static final String COMMAND_ACTION = "com.adiraimaji.ampcremote.COMMAND";
    public static final String ALT_COMMAND_ACTION = "com.adiraimaji.ampcremote.ACTION_COMMAND";
    public static final String RESULT_ACTION = "com.adiraimaji.ampcremote.RESULT";

    private TaskerConfig() {
    }

    public static void sendResult(Context context, CommandRunner.Result result, String requestId,
                                  String resultAction, String resultPackage) {
        String action = resultAction == null || resultAction.trim().isEmpty()
                ? RESULT_ACTION : resultAction.trim();
        Intent intent = new Intent(action);
        JSONObject json = result == null
                ? new JSONObject()
                : result.toJson();
        intent.putExtra("ok", result != null && result.ok);
        intent.putExtra("result", json.toString());
        intent.putExtra("error", result == null ? "" : result.error);
        intent.putExtra("server", result == null ? "" : result.serverName);
        intent.putExtra("address", result == null ? "" : result.serverAddress);
        intent.putExtra("command", result == null ? "" : result.command);
        intent.putExtra("remote", result == null ? "" : result.remote);
        intent.putExtra("action", result == null ? "" : result.action);
        if (requestId != null && !requestId.isEmpty()) intent.putExtra("requestId", requestId);
        if (resultPackage != null && !resultPackage.trim().isEmpty()) {
            intent.setPackage(resultPackage.trim());
        }
        context.sendBroadcast(intent);
    }

    public static String blurb(String mode, String serverName, String command, String state) {
        if (MODE_CONDITION.equals(mode)) {
            return "AM PC Remote: " + (serverName == null || serverName.isEmpty() ? "PC" : serverName)
                    + " is " + (state == null || state.isEmpty() ? "online" : state);
        }
        String text = command == null ? "" : command.trim();
        if (text.length() > 100) text = text.substring(0, 97) + "...";
        return text.isEmpty() ? "AM PC Remote action" : text;
    }
}
