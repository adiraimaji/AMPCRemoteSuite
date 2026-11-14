package com.adiraimaji.ampcremote;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.ProgressDialog;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/** Server discovery, pairing and the entry point of the app. */
public class MainActivity extends Activity {
    private ServerStore store;
    private LinearLayout listView;
    private TextView statusView;
    private final Map<String, Boolean> reachable = new ConcurrentHashMap<>();
    private final Handler handler = new Handler(Looper.getMainLooper());
    private volatile boolean scanning;
    private boolean firstScan = true;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        store = ServerStore.get(this);
        setContentView(buildUi());
    }

    @Override
    protected void onResume() {
        super.onResume();
        render();
        healthCheckAll();
        scan();
    }

    // ------------------------------------------------------------ UI shell

    private View buildUi() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Ui.color(this, R.color.bg));

        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(dp(18), dp(18), dp(8), dp(4));

        LinearLayout titles = new LinearLayout(this);
        titles.setOrientation(LinearLayout.VERTICAL);
        TextView title = Ui.text(this, "AM PC Remote", 25, Ui.color(this, R.color.text), true);
        TextView subtitle = Ui.text(this, "Servers on your Wi-Fi", 13, Ui.color(this, R.color.muted), false);
        titles.addView(title);
        titles.addView(subtitle);
        header.addView(titles, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        TextView more = Ui.text(this, "\u22EE", 26, Ui.color(this, R.color.muted), true);
        more.setGravity(Gravity.CENTER);
        more.setContentDescription("More options");
        more.setPadding(dp(8), dp(4), dp(8), dp(8));
        more.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                showOverflow(view);
            }
        });
        header.addView(more, new LinearLayout.LayoutParams(dp(48), dp(48)));
        root.addView(header, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        statusView = Ui.text(this, "Searching your Wi-Fi for a running PC...", 12.5f,
                Ui.color(this, R.color.muted), false);
        statusView.setPadding(dp(18), 0, dp(18), dp(8));
        root.addView(statusView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setClipToPadding(false);
        listView = new LinearLayout(this);
        listView.setOrientation(LinearLayout.VERTICAL);
        listView.setPadding(dp(10), dp(2), dp(10), dp(16));
        scroll.addView(listView, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(scroll, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        LinearLayout footer = new LinearLayout(this);
        footer.setOrientation(LinearLayout.HORIZONTAL);
        footer.setPadding(dp(12), dp(4), dp(12), dp(14));

        Button scan = Ui.button(this, "Scan for servers", true);
        scan.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                scan();
            }
        });
        LinearLayout.LayoutParams scanParams = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        scanParams.setMargins(0, 0, dp(5), 0);
        footer.addView(scan, scanParams);

        Button add = Ui.button(this, "Add by IP", false);
        add.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                showAddDialog();
            }
        });
        LinearLayout.LayoutParams addParams = new LinearLayout.LayoutParams(0,
                ViewGroup.LayoutParams.WRAP_CONTENT, 1);
        addParams.setMargins(dp(5), 0, 0, 0);
        footer.addView(add, addParams);

        root.addView(footer, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        return root;
    }

    private void setStatus(String text) {
        if (statusView != null) statusView.setText(text);
    }

    // ------------------------------------------------------------ discovery

    private void scan() {
        if (scanning) return;
        scanning = true;
        setStatus("Searching your Wi-Fi for a running PC...");
        Discovery.scan(this, 3400, new Discovery.Callback() {
            @Override
            public void onFound(final ServerInfo server) {
                store.upsert(server);
                reachable.put(server.key(), Boolean.TRUE);
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        render();
                    }
                });
            }

            @Override
            public void onFinished(final List<ServerInfo> servers) {
                scanning = false;
                handler.post(new Runnable() {
                    @Override
                    public void run() {
                        int count = store.size();
                        if (count == 0) {
                            setStatus("No server found. Start AM PC Remote on the PC, or add its IP address.");
                        } else {
                            setStatus(count == 1
                                    ? "1 server ready. Tap it to connect."
                                    : count + " servers ready. Tap one to connect.");
                        }
                        render();
                    }
                });
            }
        });
        if (firstScan) {
            firstScan = false;
            healthCheckAll();
        }
    }

    private void healthCheckAll() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                boolean changed = false;
                for (ServerInfo info : store.all()) {
                    boolean ok;
                    try {
                        JSONObject health = ApiClient.health(info.host, info.port);
                        ok = health.optBoolean("ok", false);
                        if (ok) {
                            ServerInfo fresh = new ServerInfo();
                            fresh.id = health.optString("id", info.id);
                            fresh.name = health.optString("name", info.name);
                            fresh.host = info.host;
                            fresh.port = health.optInt("port", info.port);
                            fresh.version = health.optString("version", info.version);
                            fresh.pinRequired = health.optBoolean("pinRequired", info.pinRequired);
                            store.upsert(fresh);
                        }
                    } catch (Exception error) {
                        ok = false;
                    }
                    Boolean previous = reachable.put(info.key(), ok);
                    if (previous == null || previous != ok) changed = true;
                }
                if (changed) {
                    handler.post(new Runnable() {
                        @Override
                        public void run() {
                            render();
                        }
                    });
                }
            }
        }, "ampc-health").start();
    }

    // ------------------------------------------------------------ list

    private void render() {
        if (listView == null) return;
        listView.removeAllViews();
        List<ServerInfo> servers = store.all();
        if (servers.isEmpty()) {
            addCard(emptyCard());
            return;
        }
        for (ServerInfo server : servers) {
            addCard(serverCard(server));
        }
        TextView hint = Ui.text(this,
                "Tip: the pairing PIN is in the PC tray icon menu (Show pairing PIN).",
                11.5f, Ui.color(this, R.color.muted), false);
        hint.setGravity(Gravity.CENTER);
        hint.setPadding(dp(18), dp(10), dp(18), dp(4));
        listView.addView(hint, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
    }

    private View emptyCard() {
        LinearLayout card = Ui.card(this);
        TextView title = Ui.text(this, "No server paired yet", 17, Ui.color(this, R.color.text), true);
        TextView text = Ui.text(this,
                "1. Run AM PC Remote on the Windows PC.\n"
                        + "2. Keep the phone on the same Wi-Fi network.\n"
                        + "3. Tap Scan for servers, then enter the PIN from the PC tray icon.\n\n"
                        + "If discovery is blocked by the router, use Add by IP with the address shown in the tray menu.",
                13.5f, Ui.color(this, R.color.muted), false);
        text.setPadding(0, dp(8), 0, 0);
        card.addView(title);
        card.addView(text);
        return card;
    }

    private View serverCard(final ServerInfo server) {
        LinearLayout card = Ui.card(this);
        boolean paired = server.paired();
        Boolean healthy = reachable.get(server.key());

        LinearLayout top = new LinearLayout(this);
        top.setOrientation(LinearLayout.HORIZONTAL);
        top.setGravity(Gravity.CENTER_VERTICAL);

        TextView name = Ui.text(this,
                server.name == null || server.name.isEmpty() ? "AM PC Remote" : server.name,
                17, Ui.color(this, R.color.text), true);
        top.addView(name, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));

        String badgeText;
        int badgeColor;
        if (paired && Boolean.FALSE.equals(healthy)) {
            badgeText = "OFFLINE";
            badgeColor = Ui.color(this, R.color.red);
        } else if (paired) {
            badgeText = "PAIRED";
            badgeColor = Ui.color(this, R.color.green);
        } else if (Boolean.FALSE.equals(healthy)) {
            badgeText = "OFFLINE";
            badgeColor = Ui.color(this, R.color.red);
        } else if (server.pinRequired) {
            badgeText = "PIN REQUIRED";
            badgeColor = Ui.color(this, R.color.amber);
        } else {
            badgeText = "READY";
            badgeColor = Ui.color(this, R.color.accent);
        }
        top.addView(badge(badgeText, badgeColor));
        card.addView(top);

        TextView address = Ui.text(this,
                server.address() + (server.version.isEmpty() ? "" : "  \u00B7  v" + server.version),
                12.5f, Ui.color(this, R.color.muted), false);
        address.setPadding(0, dp(5), 0, 0);
        card.addView(address);

        String state;
        if (paired) {
            state = Boolean.FALSE.equals(healthy)
                    ? "Not reachable right now. Tap to retry."
                    : "Paired. Tap to open the remote.";
        } else if (Boolean.FALSE.equals(healthy)) {
            state = "Not reachable. Check Wi-Fi and that the server is running.";
        } else {
            state = "Tap to pair with the PIN shown on the PC.";
        }
        TextView info = Ui.text(this, state, 12, Ui.color(this, R.color.muted), false);
        info.setPadding(0, dp(8), 0, 0);
        card.addView(info);

        card.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View view) {
                connect(server);
            }
        });
        card.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View view) {
                serverOptions(server);
                return true;
            }
        });
        return card;
    }

    private TextView badge(String text, int color) {
        TextView view = Ui.text(this, text, 10.5f, color, true);
        view.setLetterSpacing(0.06f);
        view.setPadding(dp(9), dp(4), dp(9), dp(4));
        view.setBackground(Ui.background(this,
                Color.argb(0x26, Color.red(color), Color.green(color), Color.blue(color)), color, 999f));
        return view;
    }

    private void addCard(View card) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        params.setMargins(dp(4), dp(5), dp(4), dp(5));
        listView.addView(card, params);
    }

    // ------------------------------------------------------------ actions

    private void connect(ServerInfo server) {
        if (server.paired()) {
            openRemote(server);
        } else {
            showPinDialog(server, "");
        }
    }

    private void openRemote(ServerInfo server) {
        Intent intent = new Intent(this, RemoteActivity.class);
        intent.putExtra(RemoteActivity.EXTRA_HOST, server.host);
        intent.putExtra(RemoteActivity.EXTRA_PORT, server.port);
        intent.putExtra(RemoteActivity.EXTRA_TOKEN, server.token);
        intent.putExtra(RemoteActivity.EXTRA_NAME, server.name);
        startActivity(intent);
    }

    private void showPinDialog(final ServerInfo server, final String error) {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(20), dp(8), dp(20), 0);

        String message = server.pinRequired
                ? "Enter the PIN shown on the PC. Right-click the AM PC Remote tray icon and choose Show pairing PIN."
                : "This server has PIN checking disabled. Tap Pair to connect.";
        TextView text = Ui.text(this, message, 13.5f, Ui.color(this, R.color.muted), false);
        content.addView(text);

        if (error != null && !error.isEmpty()) {
            TextView problem = Ui.text(this, error, 13, Ui.color(this, R.color.red), false);
            problem.setPadding(0, dp(10), 0, 0);
            content.addView(problem);
        }

        final EditText pin = new EditText(this);
        pin.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        pin.setHint(server.pinRequired ? "6-digit PIN" : "not needed");
        pin.setTextSize(22);
        pin.setGravity(Gravity.CENTER);
        pin.setLetterSpacing(0.25f);
        pin.setTextColor(Ui.color(this, R.color.text));
        pin.setHintTextColor(Ui.color(this, R.color.muted));
        LinearLayout.LayoutParams pinParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        pinParams.setMargins(0, dp(14), 0, 0);
        content.addView(pin, pinParams);

        new AlertDialog.Builder(this, R.style.AppDialogTheme)
                .setTitle("Pair with " + (server.name == null ? server.host : server.name))
                .setView(content)
                .setPositiveButton("Pair", (dialog, which) -> startPair(server, pin.getText().toString()))
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void startPair(final ServerInfo server, final String pin) {
        if (server.pinRequired && pin.trim().isEmpty()) {
            showPinDialog(server, "Enter the PIN shown on the PC.");
            return;
        }
        final ProgressDialog progress = new ProgressDialog(this);
        progress.setMessage("Pairing with " + server.name + "...");
        progress.setCancelable(false);
        progress.show();

        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    ApiClient.PairResult result = ApiClient.pair(server.host, server.port, pin,
                            CommandRunner.deviceName());
                    final String name = result.hello.optString("name", server.name);
                    store.setToken(server.host, server.port, result.token, name);
                    store.setLast(server.host, server.port);
                    reachable.put(server.key(), Boolean.TRUE);
                    final ServerInfo updated = store.find(server.host, server.port);
                    handler.post(new Runnable() {
                        @Override
                        public void run() {
                            progress.dismiss();
                            render();
                            if (updated != null) openRemote(updated);
                        }
                    });
                } catch (final Exception error) {
                    handler.post(new Runnable() {
                        @Override
                        public void run() {
                            progress.dismiss();
                            showPinDialog(server, friendly(error));
                        }
                    });
                }
            }
        }, "ampc-pair").start();
    }

    private String friendly(Exception error) {
        if (error instanceof ApiClient.ApiException) {
            int status = ((ApiClient.ApiException) error).status;
            if (status == 401) return error.getMessage().contains("PIN") ? error.getMessage() : "Wrong PIN. Try again.";
            return error.getMessage();
        }
        return "Could not reach " + "the PC. Check that it is on and on the same Wi-Fi network.";
    }

    private void serverOptions(final ServerInfo server) {
        final boolean paired = server.paired();
        String[] items = paired
                ? new String[]{"Open remote", "Pair again", "Forget pairing", "Copy address", "Remove server"}
                : new String[]{"Pair", "Copy address", "Remove server"};
        new AlertDialog.Builder(this, R.style.AppDialogTheme)
                .setTitle(server.name)
                .setItems(items, (dialog, which) -> {
                    String choice = items[which];
                    if (choice.equals("Open remote")) {
                        openRemote(server);
                    } else if (choice.equals("Pair") || choice.equals("Pair again")) {
                        store.clearToken(server.host, server.port);
                        render();
                        showPinDialog(server, "");
                    } else if (choice.equals("Forget pairing")) {
                        store.clearToken(server.host, server.port);
                        render();
                        Ui.toast(MainActivity.this, "Pairing forgotten.");
                    } else if (choice.equals("Copy address")) {
                        copy(server.address());
                    } else if (choice.equals("Remove server")) {
                        store.remove(server.host, server.port);
                        reachable.remove(server.key());
                        render();
                    }
                })
                .show();
    }

    private void copy(String text) {
        ClipboardManager manager = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        if (manager != null) {
            manager.setPrimaryClip(ClipData.newPlainText("AM PC Remote", text));
            Ui.toast(this, "Copied " + text);
        }
    }

    // ------------------------------------------------------------ manual add

    private void showAddDialog() {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(20), dp(8), dp(20), 0);

        TextView text = Ui.text(this,
                "Enter the PC address shown in the tray menu or the PC admin page.",
                13, Ui.color(this, R.color.muted), false);
        content.addView(text);

        final EditText address = new EditText(this);
        address.setHint("192.168.1.50");
        address.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        address.setSingleLine(true);
        address.setTextColor(Ui.color(this, R.color.text));
        address.setHintTextColor(Ui.color(this, R.color.muted));
        LinearLayout.LayoutParams addressParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        addressParams.setMargins(0, dp(12), 0, 0);
        content.addView(address, addressParams);

        final EditText port = new EditText(this);
        port.setHint("Port (default 9600)");
        port.setInputType(InputType.TYPE_CLASS_NUMBER);
        port.setSingleLine(true);
        port.setText("9600");
        port.setTextColor(Ui.color(this, R.color.text));
        port.setHintTextColor(Ui.color(this, R.color.muted));
        LinearLayout.LayoutParams portParams = new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        portParams.setMargins(0, dp(8), 0, 0);
        content.addView(port, portParams);

        new AlertDialog.Builder(this, R.style.AppDialogTheme)
                .setTitle("Add server by IP")
                .setView(content)
                .setPositiveButton("Connect", (dialog, which) -> {
                    ServerInfo parsed = ServerStore.parseAddress(address.getText().toString());
                    if (parsed == null || parsed.host.isEmpty()) {
                        Ui.toast(this, "Enter a valid IP address or host name.");
                        return;
                    }
                    String portText = port.getText().toString().trim();
                    if (portText.matches("\\d{1,5}")) {
                        try {
                            parsed.port = Integer.parseInt(portText);
                        } catch (NumberFormatException ignored) {
                            parsed.port = 9600;
                        }
                    }
                    checkManual(parsed);
                })
                .setNegativeButton("Cancel", null)
                .show();
    }

    private void checkManual(final ServerInfo parsed) {
        final ProgressDialog progress = new ProgressDialog(this);
        progress.setMessage("Checking " + parsed.address() + "...");
        progress.setCancelable(false);
        progress.show();

        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject health = ApiClient.health(parsed.host, parsed.port);
                    if (!health.optBoolean("ok", false)) throw new Exception("not ok");
                    ServerInfo found = new ServerInfo();
                    found.id = health.optString("id", "");
                    found.name = health.optString("name", "AM PC Remote");
                    found.host = parsed.host;
                    found.port = health.optInt("port", parsed.port);
                    found.version = health.optString("version", "");
                    found.pinRequired = health.optBoolean("pinRequired", true);
                    final ServerInfo stored = store.upsert(found);
                    reachable.put(stored.key(), Boolean.TRUE);
                    handler.post(new Runnable() {
                        @Override
                        public void run() {
                            progress.dismiss();
                            render();
                            if (stored.paired()) openRemote(stored);
                            else showPinDialog(stored, "");
                        }
                    });
                } catch (final Exception error) {
                    handler.post(new Runnable() {
                        @Override
                        public void run() {
                            progress.dismiss();
                            new AlertDialog.Builder(MainActivity.this, R.style.AppDialogTheme)
                                    .setTitle("Server not reachable")
                                    .setMessage("Could not reach " + parsed.address()
                                            + ".\n\nCheck that AM PC Remote is running, the phone is on the same Wi-Fi,"
                                            + " and the firewall allows TCP " + parsed.port + ".")
                                    .setPositiveButton("OK", null)
                                    .show();
                        }
                    });
                }
            }
        }, "ampc-check").start();
    }

    // ------------------------------------------------------------ overflow

    private void showOverflow(View anchor) {
        PopupMenu popup = new PopupMenu(this, anchor);
        popup.getMenu().add("Scan for servers");
        popup.getMenu().add("Tasker and broadcast help");
        popup.getMenu().add("Forget all pairings");
        popup.getMenu().add("Remove all servers");
        popup.getMenu().add("About");
        popup.setOnMenuItemClickListener(item -> {
            String title = item.getTitle().toString();
            if (title.equals("Scan for servers")) {
                scan();
            } else if (title.equals("Tasker and broadcast help")) {
                showHelp();
            } else if (title.equals("Forget all pairings")) {
                store.clearAllTokens();
                render();
                Ui.toast(this, "All pairings forgotten.");
            } else if (title.equals("Remove all servers")) {
                store.removeAll();
                reachable.clear();
                render();
            } else if (title.equals("About")) {
                showAbout();
            }
            return true;
        });
        popup.show();
    }

    private void showHelp() {
        String text = "TASKER ACTION PLUGIN\n"
                + "Tasker > Action > Plugin > AM PC Remote Action.\n"
                + "Type as many lines as you like: every line is one command and they run\n"
                + "in order. wait 1 / waitms 250 pause on the phone (seconds, milliseconds).\n"
                + "Blank lines and lines starting with # are skipped.\n\n"
                + CommandParser.helpText()
                + "\n\nTASKER CONDITION\n"
                + "Add the same plugin as a condition and choose Mode: Condition. "
                + "It is true while the PC is reachable (or paired).\n\n"
                + "DIRECT BROADCAST (Tasker Send Intent)\n"
                + "Action: com.adiraimaji.ampcremote.COMMAND\n"
                + "Package: com.adiraimaji.ampcremote\n"
                + "Extra: cmd=next  (or remote/action/args)\n"
                + "A whole script fits in the same extra (real line breaks).\n"
                + "Optional: value, server, token, pin, resultAction\n\n"
                + "RESULT BROADCAST\n"
                + "Action: com.adiraimaji.ampcremote.RESULT\n"
                + "Extras: ok, result, error, server, command\n"
                + "result holds JSON with steps[] (line, command, ok) and elapsedMs\n\n"
                + "The web remote is identical to the PC web app; every remote and action is available.";
        showTextDialog("Tasker and broadcasts", text);
    }

    private void showAbout() {
        String text = "AM PC Remote for Android 1.0.0\n"
                + "Package: com.adiraimaji.ampcremote\n\n"
                + "Controls the AM PC Remote Windows server over your local network. "
                + "The server must be running on the PC and both devices must be on the same Wi-Fi.\n\n"
                + "Discovery uses UDP 9601; commands use HTTP 9600. Traffic stays on the LAN. "
                + "No cloud account and no internet access are required.";
        showTextDialog("About", text);
    }

    private void showTextDialog(String title, String text) {
        ScrollView scroll = new ScrollView(this);
        TextView view = Ui.monospace(this, text, 12.5f);
        view.setTextIsSelectable(true);
        view.setPadding(dp(20), dp(12), dp(20), dp(4));
        scroll.addView(view);
        new AlertDialog.Builder(this, R.style.AppDialogTheme)
                .setTitle(title)
                .setView(scroll)
                .setPositiveButton("Close", null)
                .show();
    }

    private int dp(float value) {
        return Ui.dp(this, value);
    }
}
