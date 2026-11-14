package com.adiraimaji.ampcremote;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/** SharedPreferences-backed list of servers and their pairing tokens. */
public class ServerStore {
    private static final String PREFS = "am_pc_remote";
    private static final String KEY_SERVERS = "servers";
    private static final String KEY_LAST = "last_server";

    private static ServerStore instance;

    private final SharedPreferences prefs;
    private final List<ServerInfo> servers = new ArrayList<>();
    private String lastKey = "";

    private ServerStore(Context context) {
        prefs = context.getApplicationContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        load();
    }

    public static synchronized ServerStore get(Context context) {
        if (instance == null) instance = new ServerStore(context);
        return instance;
    }

    private void load() {
        servers.clear();
        String raw = prefs.getString(KEY_SERVERS, "");
        if (raw != null && !raw.isEmpty()) {
            try {
                JSONArray array = new JSONArray(raw);
                for (int i = 0; i < array.length(); i++) {
                    JSONObject object = array.optJSONObject(i);
                    if (object == null) continue;
                    ServerInfo info = ServerInfo.fromJson(object);
                    if (info.host != null && !info.host.isEmpty()) servers.add(info);
                }
            } catch (Exception ignored) {
                // Corrupt storage is replaced by an empty list.
            }
        }
        lastKey = prefs.getString(KEY_LAST, "");
    }

    private void save() {
        JSONArray array = new JSONArray();
        for (ServerInfo info : servers) array.put(info.toJson());
        prefs.edit()
                .putString(KEY_SERVERS, array.toString())
                .putString(KEY_LAST, lastKey == null ? "" : lastKey)
                .apply();
    }

    public synchronized List<ServerInfo> all() {
        List<ServerInfo> copy = new ArrayList<>();
        for (ServerInfo info : servers) copy.add(info.copy());
        Collections.sort(copy, new Comparator<ServerInfo>() {
            @Override
            public int compare(ServerInfo a, ServerInfo b) {
                if (a.paired() != b.paired()) return a.paired() ? -1 : 1;
                return a.name.compareToIgnoreCase(b.name);
            }
        });
        return copy;
    }

    public synchronized ServerInfo find(String host, int port) {
        for (ServerInfo info : servers) {
            if (info.host.equals(host) && info.port == port) return info;
        }
        return null;
    }

    /** Adds or refreshes a server found by discovery or a manual health check. */
    public synchronized ServerInfo upsert(ServerInfo discovered) {
        ServerInfo existing = find(discovered.host, discovered.port);
        if (existing == null) {
            servers.add(discovered.copy());
            existing = servers.get(servers.size() - 1);
        } else {
            if (discovered.id != null && !discovered.id.isEmpty()) existing.id = discovered.id;
            if (discovered.name != null && !discovered.name.isEmpty()) existing.name = discovered.name;
            if (discovered.version != null && !discovered.version.isEmpty()) existing.version = discovered.version;
            existing.pinRequired = discovered.pinRequired;
            existing.lastSeen = System.currentTimeMillis();
        }
        if (existing.name == null || existing.name.isEmpty()) existing.name = "AM PC Remote";
        save();
        return existing.copy();
    }

    public synchronized void setToken(String host, int port, String token, String name) {
        ServerInfo info = find(host, port);
        if (info == null) {
            info = new ServerInfo();
            info.host = host;
            info.port = port;
            info.name = name == null || name.isEmpty() ? "AM PC Remote" : name;
            servers.add(info);
        }
        info.token = token == null ? "" : token;
        if (name != null && !name.isEmpty()) info.name = name;
        lastKey = info.key();
        save();
    }

    public synchronized void clearToken(String host, int port) {
        ServerInfo info = find(host, port);
        if (info == null) return;
        info.token = "";
        save();
    }

    public synchronized void clearAllTokens() {
        for (ServerInfo info : servers) info.token = "";
        save();
    }

    public synchronized boolean remove(String host, int port) {
        ServerInfo info = find(host, port);
        if (info == null) return false;
        servers.remove(info);
        if (lastKey != null && lastKey.equals(info.key())) lastKey = "";
        save();
        return true;
    }

    public synchronized void removeAll() {
        servers.clear();
        lastKey = "";
        save();
    }

    public synchronized void setLast(String host, int port) {
        lastKey = host + ":" + port;
        save();
    }

    public synchronized ServerInfo defaultServer() {
        if (lastKey != null && !lastKey.isEmpty()) {
            for (ServerInfo info : servers) {
                if (info.key().equals(lastKey)) return info.copy();
            }
        }
        for (ServerInfo info : servers) {
            if (info.paired()) return info.copy();
        }
        return servers.isEmpty() ? null : servers.get(0).copy();
    }

    public synchronized ServerInfo firstPaired() {
        for (ServerInfo info : servers) {
            if (info.paired()) return info.copy();
        }
        return null;
    }

    /**
     * Accepts a full address (host:port), a server id, a stored name, or an
     * exact key. Returns null when nothing matches.
     */
    public synchronized ServerInfo resolve(String spec) {
        if (spec == null) return null;
        String value = spec.trim();
        if (value.isEmpty()) return null;
        for (ServerInfo info : servers) {
            if (info.key().equalsIgnoreCase(value)) return info.copy();
            if (!info.id.isEmpty() && info.id.equalsIgnoreCase(value)) return info.copy();
            if (!info.name.isEmpty() && info.name.equalsIgnoreCase(value)) return info.copy();
            if (info.host.equalsIgnoreCase(value)) return info.copy();
        }
        return parseAddress(value);
    }

    public static ServerInfo parseAddress(String value) {
        String text = value == null ? "" : value.trim();
        if (text.isEmpty()) return null;
        if (text.contains("://")) text = text.substring(text.indexOf("://") + 3);
        int slash = text.indexOf('/');
        if (slash >= 0) text = text.substring(0, slash);
        int port = 9600;
        String host = text;
        int colon = text.lastIndexOf(':');
        if (colon > 0 && colon < text.length() - 1) {
            String portText = text.substring(colon + 1);
            if (portText.matches("\\d{1,5}")) {
                try {
                    port = Integer.parseInt(portText);
                } catch (NumberFormatException ignored) {
                    port = 9600;
                }
                host = text.substring(0, colon);
            }
        }
        if (host.isEmpty()) return null;
        ServerInfo info = new ServerInfo();
        info.host = host;
        info.port = port;
        info.name = host;
        return info;
    }

    public synchronized int size() {
        return servers.size();
    }
}
