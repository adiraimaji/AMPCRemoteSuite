package com.adiraimaji.ampcremote;

import org.json.JSONException;
import org.json.JSONObject;

/** One AM PC Remote server remembered on the phone. */
public class ServerInfo {
    public String id = "";
    public String name = "";
    public String host = "";
    public int port = 9600;
    public String version = "";
    public String token = "";
    public boolean pinRequired = true;
    public long lastSeen = 0;

    public String key() {
        return host + ":" + port;
    }

    public String address() {
        return host + ":" + port;
    }

    public boolean paired() {
        return token != null && !token.isEmpty();
    }

    public JSONObject toJson() {
        JSONObject object = new JSONObject();
        try {
            object.put("id", id);
            object.put("name", name);
            object.put("host", host);
            object.put("port", port);
            object.put("version", version);
            object.put("token", token);
            object.put("pinRequired", pinRequired);
            object.put("lastSeen", lastSeen);
        } catch (JSONException ignored) {
            // Values are primitives and cannot fail.
        }
        return object;
    }

    public static ServerInfo fromJson(JSONObject object) {
        ServerInfo info = new ServerInfo();
        info.id = object.optString("id", "");
        info.name = object.optString("name", "");
        info.host = object.optString("host", "");
        info.port = object.optInt("port", 9600);
        info.version = object.optString("version", "");
        info.token = object.optString("token", "");
        info.pinRequired = object.optBoolean("pinRequired", true);
        info.lastSeen = object.optLong("lastSeen", 0);
        return info;
    }

    public ServerInfo copy() {
        return fromJson(toJson());
    }
}
