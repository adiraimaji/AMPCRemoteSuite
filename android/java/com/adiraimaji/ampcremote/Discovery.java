package com.adiraimaji.ampcremote;

import android.content.Context;

import org.json.JSONObject;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Finds AM PC Remote servers with a UDP probe on port 9601. The PC answers
 * directly to the sender's address, so no manual IP entry is needed.
 */
public final class Discovery {
    public static final int DISCOVERY_PORT = 9601;

    public interface Callback {
        /** Called from a background thread for every newly discovered server. */
        void onFound(ServerInfo server);

        /** Called from a background thread when the scan ends. */
        void onFinished(List<ServerInfo> servers);
    }

    private Discovery() {
    }

    public static Thread scan(Context context, int timeoutMs, final Callback callback) {
        final Context app = context.getApplicationContext();
        Thread thread = new Thread(new Runnable() {
            @Override
            public void run() {
                Map<String, ServerInfo> found = new LinkedHashMap<>();
                DatagramSocket socket = null;
                try {
                    socket = new DatagramSocket(null);
                    socket.setReuseAddress(true);
                    socket.bind(new InetSocketAddress(0));
                    socket.setBroadcast(true);
                    socket.setSoTimeout(250);

                    byte[] json = ("{\"am\":\"discover\",\"app\":\"com.adiraimaji.ampcremote\","
                            + "\"protocol\":2,\"name\":\"android\"}").getBytes(StandardCharsets.UTF_8);
                    byte[] plain = "AM-PC-REMOTE-DISCOVER".getBytes(StandardCharsets.UTF_8);
                    Set<InetAddress> targets = targets();

                    long deadline = System.currentTimeMillis() + Math.max(1200, timeoutMs);
                    long nextProbe = 0;
                    byte[] buffer = new byte[8192];

                    while (System.currentTimeMillis() < deadline) {
                        long now = System.currentTimeMillis();
                        if (now >= nextProbe) {
                            for (InetAddress target : targets) {
                                try {
                                    socket.send(new DatagramPacket(json, json.length, target, DISCOVERY_PORT));
                                    socket.send(new DatagramPacket(plain, plain.length, target, DISCOVERY_PORT));
                                } catch (IOException ignored) {
                                    // Some interfaces reject broadcast; try the next one.
                                }
                            }
                            nextProbe = now + 450;
                        }

                        try {
                            DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
                            socket.receive(packet);
                            String text = new String(packet.getData(), packet.getOffset(), packet.getLength(),
                                    StandardCharsets.UTF_8);
                            ServerInfo info = parse(text, packet.getAddress());
                            if (info == null) continue;
                            String key = info.key();
                            if (found.containsKey(key)) continue;
                            found.put(key, info);
                            if (callback != null) callback.onFound(info);
                        } catch (SocketTimeoutException ignored) {
                            // Probe again or wait for the deadline.
                        } catch (IOException ignored) {
                            // Keep scanning until the deadline.
                        }
                    }
                } catch (Exception ignored) {
                    // The scan simply ends with whatever was found.
                } finally {
                    if (socket != null) {
                        try {
                            socket.close();
                        } catch (Exception ignored) {
                            // ignore
                        }
                    }
                }
                if (callback != null) {
                    callback.onFinished(new ArrayList<>(found.values()));
                }
            }
        }, "ampc-discovery");
        thread.setDaemon(true);
        thread.start();
        return thread;
    }

    private static Set<InetAddress> targets() {
        Set<InetAddress> targets = new LinkedHashSet<>();
        try {
            targets.add(InetAddress.getByName("255.255.255.255"));
        } catch (Exception ignored) {
            // ignore
        }
        try {
            Enumeration<NetworkInterface> interfaces = NetworkInterface.getNetworkInterfaces();
            while (interfaces != null && interfaces.hasMoreElements()) {
                NetworkInterface network = interfaces.nextElement();
                if (!network.isUp() || network.isLoopback()) continue;
                for (InterfaceAddress address : network.getInterfaceAddresses()) {
                    InetAddress broadcast = address.getBroadcast();
                    if (broadcast != null) targets.add(broadcast);
                }
            }
        } catch (Exception ignored) {
            // fall back to the limited broadcast address
        }
        return targets;
    }

    private static ServerInfo parse(String text, InetAddress from) {
        if (text == null || text.isEmpty()) return null;
        try {
            JSONObject object = new JSONObject(text);
            String app = object.optString("app", "");
            String am = object.optString("am", "");
            boolean ours = app.contains("am-pc-remote") || "announce".equals(am) || app.equals("am-pc-remote");
            if (!ours) return null;
            String host = from.getHostAddress();
            if (host == null) return null;
            if (host.startsWith("::ffff:")) host = host.substring(7);
            if (host.startsWith("fe80:") || host.equals("127.0.0.1") || host.equals("::1")) return null;

            ServerInfo info = new ServerInfo();
            info.id = object.optString("id", "");
            info.name = object.optString("name", "AM PC Remote");
            info.host = host;
            info.port = object.optInt("port", 9600);
            info.version = object.optString("version", "");
            info.pinRequired = object.optBoolean("pinRequired", true);
            info.lastSeen = System.currentTimeMillis();
            return info;
        } catch (Exception ignored) {
            return null;
        }
    }
}
