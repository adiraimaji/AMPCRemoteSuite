package com.adiraimaji.ampcremote;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** Tiny JSON-over-HTTP client for the AM PC Remote server API. */
public final class ApiClient {
    private static final String USER_AGENT = "AM PC Remote Android/2.0";

    private ApiClient() {
    }

    public static class ApiException extends Exception {
        public final int status;

        public ApiException(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    public static class PairResult {
        public String token;
        public JSONObject hello;
        public JSONObject auth;
    }

    public static String base(String host, int port) {
        return "http://" + host + ":" + port;
    }

    public static JSONObject hello(String host, int port, int timeoutMs) throws Exception {
        return request(base(host, port) + "/api/hello", "GET", null, "", timeoutMs);
    }

    public static JSONObject health(String host, int port) throws Exception {
        return request(base(host, port) + "/health", "GET", null, "", 3000);
    }

    public static PairResult pair(String host, int port, String pin, String deviceName) throws Exception {
        JSONObject hello = hello(host, port, 4000);
        String nonce = hello.optString("nonce", "");
        boolean pinRequired = hello.optBoolean("pinRequired", true);
        String proof = "";
        if (pinRequired) {
            if (pin == null || pin.trim().isEmpty()) {
                throw new ApiException(401, "Enter the PIN shown on the PC.");
            }
            proof = sha256Hex(nonce + ":" + pin.trim());
        }
        JSONObject body = new JSONObject();
        body.put("nonce", nonce);
        body.put("proof", proof);
        body.put("clientName", deviceName == null || deviceName.isEmpty() ? "Android phone" : deviceName);
        body.put("platform", "android");

        JSONObject auth = request(base(host, port) + "/api/auth", "POST", body, "", 6000);
        String token = auth.optString("token", "");
        if (token.isEmpty()) throw new ApiException(500, "The server did not return a session token.");

        PairResult result = new PairResult();
        result.token = token;
        result.hello = hello;
        result.auth = auth;
        return result;
    }

    public static JSONObject action(String host, int port, String token,
                                    String remote, String action, JSONObject args) throws Exception {
        JSONObject body = new JSONObject();
        body.put("remote", remote);
        body.put("action", action);
        body.put("args", args == null ? new JSONObject() : args);
        return request(base(host, port) + "/api/action", "POST", body, token, 12000);
    }

    public static JSONObject state(String host, int port, String token) throws Exception {
        return request(base(host, port) + "/api/state", "GET", null, token, 5000);
    }

    public static void logout(String host, int port, String token) {
        try {
            request(base(host, port) + "/api/logout", "POST", new JSONObject(), token, 3000);
        } catch (Exception ignored) {
            // Best effort.
        }
    }

    public static JSONObject request(String url, String method, JSONObject body,
                                     String token, int timeoutMs) throws Exception {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setRequestMethod(method);
            connection.setConnectTimeout(timeoutMs);
            connection.setReadTimeout(timeoutMs);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", USER_AGENT);
            connection.setRequestProperty("Connection", "close");
            if (token != null && !token.isEmpty()) {
                connection.setRequestProperty("Authorization", "Bearer " + token);
            }
            if (body != null) {
                byte[] payload = body.toString().getBytes(StandardCharsets.UTF_8);
                connection.setDoOutput(true);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                connection.setFixedLengthStreamingMode(payload.length);
                OutputStream out = connection.getOutputStream();
                out.write(payload);
                out.flush();
                out.close();
            }

            int status = connection.getResponseCode();
            InputStream stream = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
            String text = read(stream);
            JSONObject object;
            try {
                object = text.isEmpty() ? new JSONObject() : new JSONObject(text);
            } catch (Exception parse) {
                if (status >= 400) throw new ApiException(status, text.isEmpty() ? "HTTP " + status : text);
                throw new ApiException(status, "The server returned an unexpected response.");
            }
            if (status >= 400) {
                throw new ApiException(status, object.optString("error", "HTTP " + status));
            }
            return object;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static String read(InputStream stream) throws Exception {
        if (stream == null) return "";
        BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8));
        StringBuilder text = new StringBuilder();
        String line;
        while ((line = reader.readLine()) != null) text.append(line);
        reader.close();
        return text.toString();
    }

    public static String sha256Hex(String value) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(hash.length * 2);
        for (byte b : hash) {
            hex.append(Character.forDigit((b >> 4) & 0xF, 16));
            hex.append(Character.forDigit(b & 0xF, 16));
        }
        return hex.toString();
    }
}
