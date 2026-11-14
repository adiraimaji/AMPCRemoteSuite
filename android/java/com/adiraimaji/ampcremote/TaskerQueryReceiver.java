package com.adiraimaji.ampcremote;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Bundle;

/**
 * Tasker condition plugin. Tasker treats result code 16 as true and 17 as
 * false, which matches the Locale plugin contract used by Unified Remote.
 */
public class TaskerQueryReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        Bundle bundle = intent == null ? null : intent.getBundleExtra(TaskerConfig.EXTRA_BUNDLE);
        final String spec = bundle == null ? "" : bundle.getString(TaskerConfig.KEY_SERVER, "");
        final String state = bundle == null
                ? "online" : bundle.getString(TaskerConfig.KEY_STATE, "online");
        final Context app = context.getApplicationContext();
        final PendingResult pending = goAsync();

        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean ok = false;
                try {
                    ServerStore store = ServerStore.get(app);
                    ServerInfo server = store.resolve(spec);
                    if (server == null) server = store.defaultServer();
                    if (server != null) {
                        if ("paired".equalsIgnoreCase(state)) {
                            ok = CommandRunner.isPaired(server);
                        } else {
                            ok = CommandRunner.isReachable(server);
                        }
                    }
                } catch (Exception ignored) {
                    ok = false;
                }
                setResultCode(ok ? 16 : 17);
                setResultData(ok ? "true" : "false");
                pending.finish();
            }
        }, "ampc-tasker-query").start();
    }
}
