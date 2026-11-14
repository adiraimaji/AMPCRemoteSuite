package com.adiraimaji.ampcremote;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

/** Runs a saved Tasker action plugin setting. */
public class TaskerFireReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        Bundle bundle = intent.getBundleExtra(TaskerConfig.EXTRA_BUNDLE);
        if (bundle == null) return;

        String mode = bundle.getString(TaskerConfig.KEY_MODE, TaskerConfig.MODE_ACTION);
        if (TaskerConfig.MODE_CONDITION.equals(mode)) return;

        final String command = bundle.getString(TaskerConfig.KEY_COMMAND, "");
        if (command == null || command.trim().isEmpty()) return;

        final String server = bundle.getString(TaskerConfig.KEY_SERVER, "");
        final String pin = bundle.getString(TaskerConfig.KEY_PIN, "");
        final String token = bundle.getString(TaskerConfig.KEY_TOKEN, "");
        final boolean broadcast = bundle.getBoolean(TaskerConfig.KEY_BROADCAST, false);
        final String resultAction = bundle.getString(TaskerConfig.KEY_RESULT_ACTION, "");
        final String requestId = intent.getStringExtra("requestId");
        final Context app = context.getApplicationContext();
        final PendingResult pending = goAsync();

        new Thread(new Runnable() {
            @Override
            public void run() {
                CommandRunner.Result result;
                try {
                    result = CommandRunner.execute(app, server, token, pin, command);
                } catch (Exception error) {
                    result = new CommandRunner.Result();
                    result.ok = false;
                    result.error = error.getMessage() == null ? error.toString() : error.getMessage();
                    result.command = command;
                }
                if (broadcast) {
                    TaskerConfig.sendResult(app, result, requestId, resultAction, null);
                }
                pending.finish();
            }
        }, "ampc-tasker-fire").start();
    }
}
