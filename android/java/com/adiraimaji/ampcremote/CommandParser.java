package com.adiraimaji.ampcremote;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Turns a short human command into an (remote, action, args) API call.
 *
 * Explicit form:      am.media.__media {"key":"next"}
 * JSON form:          {"remote":"am.media","action":"__volume","args":{"op":"up"}}
 * Convenient aliases: next, mute, volume up, text Hello, key ctrl+alt+del,
 *                     lock, open notepad, clipboard get, ...
 */
public final class CommandParser {
    public static class Command {
        public String remote = "";
        public String action = "";
        public JSONObject args = new JSONObject();
        public String followRemote = "";
        public String followAction = "";
        public JSONObject followArgs = new JSONObject();

        public String describe() {
            String base = remote + "." + action;
            if (args.length() > 0) base += " " + args;
            if (followAction != null && !followAction.isEmpty()) {
                base += " ; " + followRemote + "." + followAction;
            }
            return base;
        }
    }

    /** One line of a script: either a real command or a local wait. */
    public static class Step {
        public boolean wait;
        public long waitMs;
        public Command command;
        public int line;
        public String source = "";

        public String describe() {
            if (!wait) return command == null ? "" : command.describe();
            if (waitMs >= 1000 && waitMs % 1000 == 0) return "wait " + (waitMs / 1000) + "s";
            if (waitMs >= 1000) return "wait " + (waitMs / 1000.0) + "s";
            return "wait " + waitMs + "ms";
        }
    }

    private CommandParser() {
    }

    public static Command parse(String raw) throws Exception {
        if (raw == null || raw.trim().isEmpty()) throw new IllegalArgumentException("The command is empty.");
        String text = raw.trim();
        Command command = new Command();

        if (text.startsWith("{")) {
            JSONObject object = new JSONObject(text);
            command.remote = object.optString("remote", "");
            command.action = object.optString("action", "");
            JSONObject args = object.optJSONObject("args");
            if (args != null) command.args = args;
            if (command.remote.isEmpty() || command.action.isEmpty()) {
                throw new IllegalArgumentException("JSON commands need remote and action.");
            }
            return command;
        }

        int split = firstSpace(text);
        String head = split < 0 ? text : text.substring(0, split);
        String rest = split < 0 ? "" : text.substring(split + 1).trim();
        String lower = head.toLowerCase(Locale.US);

        int dot = head.indexOf('.');
        if (dot > 0 && dot < head.length() - 1) {
            command.remote = head.substring(0, dot);
            command.action = head.substring(dot + 1);
            if (!rest.isEmpty()) {
                if (rest.startsWith("{")) command.args = new JSONObject(rest);
                else command.args.put("text", rest);
            }
            return command;
        }

        switch (lower) {
            case "play":
            case "pause":
            case "toggle":
            case "playpause":
            case "resume":
                return media("playpause");
            case "next":
            case "skip":
                return media("next");
            case "previous":
            case "prev":
                return media("previous");
            case "stop":
                return media("stop");
            case "mute":
            case "unmute":
                return volume("mute", 0);
            case "volup":
            case "volumeup":
            case "louder":
                return volume("up", 0);
            case "voldown":
            case "volumedown":
            case "quieter":
                return volume("down", 0);
            case "volume":
                return parseVolume(rest);
            case "lock":
                return power("lock", false);
            case "screenoff":
            case "monitoroff":
                return power("monitoroff", false);
            case "sleep":
                return power("sleep", false);
            case "restart":
            case "reboot":
                return power("restart", true);
            case "shutdown":
            case "poweroff":
                return power("shutdown", true);
            case "text":
            case "type":
                return typed(rest, false);
            case "send":
                return typed(rest, true);
            case "key":
            case "keys":
            case "press":
            case "combo":
                return keys(rest);
            case "hold":
            case "keydown":
            case "keepdown":
                return keyHold(rest, true);
            case "release":
            case "keyup":
            case "unhold":
                return keyHold(rest, false);
            case "click":
                return pointer("click");
            case "rightclick":
                return pointer("rightclick");
            case "doubleclick":
                return pointer("doubleclick");
            case "middleclick":
            case "midclick":
                return pointer("middleclick");
            case "scrollup":
                return scroll(-420);
            case "scrolldown":
                return scroll(420);
            case "drag":
                return pointer("down");
            case "drop":
                return pointer("up");
            case "open":
            case "launch":
                return open(rest);
            case "app":
                return open(rest);
            case "clipboard":
            case "clip":
                return clipboard(rest);
            case "copy":
                return keys("ctrl+c");
            case "paste":
                return keys("ctrl+v");
            case "undo":
                return keys("ctrl+z");
            case "redo":
                return keys("ctrl+y");
            case "enter":
            case "return":
                return keys("enter");
            case "esc":
            case "escape":
                return keys("esc");
            case "backspace":
                return keys("backspace");
            case "tab":
                return keys("tab");
            case "alttab":
            case "alt-tab":
            case "switch":
                return keys("alt+tab");
            case "close":
                return window("close");
            case "maximize":
                return window("maximize");
            case "minimize":
                return window("minimize");
            case "taskview":
                return window("taskview");
            case "desktop":
                return window("desktop");
            case "procs":
            case "processes":
                return procs();
            case "status":
                return status();
            case "media":
                if (rest.isEmpty()) throw new IllegalArgumentException("Use: media play|next|previous|stop");
                return media(rest.toLowerCase(Locale.US));
            case "pointer":
                return pointerRest(rest);
            case "power":
                return parsePower(rest);
            case "window":
                if (rest.isEmpty()) throw new IllegalArgumentException("Use: window close|maximize|minimize|taskview|desktop");
                return window(rest.toLowerCase(Locale.US));
            case "browser":
                return browser(rest);
            case "presentation":
                return presentation(rest);
            case "keyboard":
                return keyboard(rest);
            case "trackpad":
                return pointerRest(rest);
            default:
                throw new IllegalArgumentException(
                        "Unknown command: " + head + ". Use remote.action or a shortcut such as play, mute, text, lock.");
        }
    }

    /**
     * Splits a Tasker command box into steps: one command per line, in order.
     * Blank lines and lines starting with # are skipped. "wait 2" and
     * "waitms 250" pause on the phone only and are never sent to the PC.
     */
    public static List<Step> parseScript(String raw) throws Exception {
        if (raw == null) throw new IllegalArgumentException("The command is empty.");

        String[] lines = raw.split("\r\n|\r|\n", -1);
        List<Integer> numbers = new ArrayList<>();
        List<String> texts = new ArrayList<>();
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i].trim();
            if (line.isEmpty() || line.startsWith("#")) continue;
            numbers.add(i + 1);
            texts.add(line);
        }
        if (texts.isEmpty()) throw new IllegalArgumentException("The command is empty.");

        boolean script = texts.size() > 1;
        List<Step> steps = new ArrayList<>();
        for (int i = 0; i < texts.size(); i++) {
            String line = texts.get(i);
            Step step = new Step();
            step.line = numbers.get(i);
            step.source = line;
            try {
                long waitMs = parseWait(line);
                if (waitMs >= 0) {
                    step.wait = true;
                    step.waitMs = waitMs;
                } else {
                    step.command = parse(line);
                }
            } catch (Exception error) {
                String message = error.getMessage() == null ? error.toString() : error.getMessage();
                throw new IllegalArgumentException(
                        script ? "Line " + step.line + ": " + message : message, error);
            }
            steps.add(step);
        }
        return steps;
    }

    /** Returns the wait in milliseconds, or -1 when the line is not a wait. */
    private static long parseWait(String line) {
        int space = firstSpace(line);
        String head = (space < 0 ? line : line.substring(0, space)).toLowerCase(Locale.US);
        if (!head.equals("wait") && !head.equals("waitms")) return -1;

        String rest = space < 0 ? "" : line.substring(space + 1).trim();
        if (rest.isEmpty()) {
            throw new IllegalArgumentException(head.equals("wait")
                    ? "Use: wait 2   (seconds, decimals such as wait 1.5)"
                    : "Use: waitms 250   (milliseconds)");
        }

        String number = rest.toLowerCase(Locale.US);
        boolean milliseconds = head.equals("waitms");
        if (number.endsWith("ms")) {
            number = number.substring(0, number.length() - 2).trim();
            milliseconds = true;
        } else if (number.endsWith("s")) {
            number = number.substring(0, number.length() - 1).trim();
            milliseconds = false;
        }

        double value;
        try {
            value = Double.parseDouble(number);
        } catch (NumberFormatException error) {
            throw new IllegalArgumentException("Not a number: " + rest + "   Use: wait 2 or waitms 250");
        }
        if (Double.isNaN(value) || Double.isInfinite(value) || value < 0) {
            throw new IllegalArgumentException("The wait must be zero or more: " + rest);
        }
        double ms = milliseconds ? value : value * 1000.0;
        if (ms > 86400000.0) throw new IllegalArgumentException("The wait is longer than a day.");
        return Math.round(ms);
    }

    private static int firstSpace(String text) {
        for (int i = 0; i < text.length(); i++) {
            if (Character.isWhitespace(text.charAt(i))) return i;
        }
        return -1;
    }

    private static Command media(String key) throws Exception {
        String normalized = key == null ? "" : key.trim().toLowerCase(Locale.US);
        if (normalized.equals("play") || normalized.equals("pause") || normalized.equals("toggle")
                || normalized.equals("resume")) {
            normalized = "playpause";
        } else if (normalized.equals("skip")) {
            normalized = "next";
        } else if (normalized.equals("prev")) {
            normalized = "previous";
        }
        if (!normalized.equals("playpause") && !normalized.equals("next")
                && !normalized.equals("previous") && !normalized.equals("stop")) {
            throw new IllegalArgumentException("Unknown media key: " + key);
        }
        Command command = new Command();
        command.remote = "am.media";
        command.action = "__media";
        command.args.put("key", normalized);
        return command;
    }

    private static Command volume(String op, int value) throws Exception {
        Command command = new Command();
        command.remote = "am.media";
        command.action = "__volume";
        command.args.put("op", op);
        if (op.equals("set")) command.args.put("value", Math.max(0, Math.min(100, value)));
        return command;
    }

    private static Command parseVolume(String rest) throws Exception {
        String value = rest.trim().toLowerCase(Locale.US);
        if (value.isEmpty()) throw new IllegalArgumentException("Use: volume 0-100 | up | down | mute");
        if (value.matches("\\d{1,3}")) return volume("set", Integer.parseInt(value));
        if (value.equals("up") || value.equals("down") || value.equals("mute") || value.equals("get")) {
            return volume(value, 0);
        }
        throw new IllegalArgumentException("Use: volume 0-100 | up | down | mute");
    }

    private static Command keys(String combo) throws Exception {
        if (combo == null || combo.trim().isEmpty()) throw new IllegalArgumentException("No key specified.");
        Command command = new Command();
        command.remote = "am.keyboard";
        command.action = "__keys";
        JSONArray keys = new JSONArray();
        keys.put(combo.trim());
        command.args.put("keys", keys);
        return command;
    }

    /** Hold (down) or release (up) a key without tapping it, for combinations. */
    private static Command keyHold(String combo, boolean down) throws Exception {
        if (combo == null || combo.trim().isEmpty()) {
            throw new IllegalArgumentException(down
                    ? "Use: hold alt   (or hold ctrl+shift)"
                    : "Use: release alt   (or release ctrl+shift)");
        }
        Command command = new Command();
        command.remote = "am.keyboard";
        command.action = down ? "__keydown" : "__keyup";
        JSONArray keys = new JSONArray();
        keys.put(combo.trim());
        command.args.put("keys", keys);
        return command;
    }

    private static Command typed(String text, boolean enter) throws Exception {
        if (text == null || text.isEmpty()) throw new IllegalArgumentException("No text specified.");
        Command command = new Command();
        command.remote = "am.keyboard";
        command.action = "__text";
        command.args.put("text", text);
        if (enter) {
            command.followRemote = "am.keyboard";
            command.followAction = "__keys";
            JSONArray keys = new JSONArray();
            keys.put("enter");
            command.followArgs.put("keys", keys);
        }
        return command;
    }

    private static Command pointer(String op) throws Exception {
        Command command = new Command();
        command.remote = "am.trackpad";
        command.action = "__pointer";
        command.args.put("op", op);
        return command;
    }

    private static Command pointerRest(String rest) throws Exception {
        if (rest == null || rest.trim().isEmpty()) throw new IllegalArgumentException("Use: pointer click|rightclick|doubleclick");
        int space = firstSpace(rest);
        String op = space < 0 ? rest.trim() : rest.substring(0, space).trim();
        String tail = space < 0 ? "" : rest.substring(space + 1).trim();
        Command command = pointer(op.toLowerCase(Locale.US));
        if (!tail.isEmpty()) {
            if (tail.startsWith("{")) {
                JSONObject args = new JSONObject(tail);
                java.util.Iterator<String> names = args.keys();
                while (names.hasNext()) {
                    String name = names.next();
                    command.args.put(name, args.get(name));
                }
            } else if (op.equalsIgnoreCase("scroll")) {
                command.args.put("dy", Integer.parseInt(tail));
            }
        }
        return command;
    }

    private static Command scroll(int dy) throws Exception {
        Command command = pointer("scroll");
        command.args.put("dy", dy);
        return command;
    }

    private static Command power(String mode, boolean confirm) throws Exception {
        Command command = new Command();
        command.remote = "am.power";
        command.action = "__power";
        command.args.put("mode", mode);
        if (confirm) command.args.put("confirm", true);
        return command;
    }

    private static Command parsePower(String rest) throws Exception {
        String mode = rest == null ? "" : rest.trim().toLowerCase(Locale.US);
        if (mode.isEmpty()) throw new IllegalArgumentException("Use: power lock|screenoff|sleep|restart|shutdown");
        boolean confirm = mode.equals("restart") || mode.equals("shutdown");
        return power(mode, confirm);
    }

    private static Command open(String rest) throws Exception {
        if (rest == null || rest.trim().isEmpty()) throw new IllegalArgumentException("Use: open <app id or target>");
        Command command = new Command();
        command.remote = "am.system";
        command.action = "__open";
        command.args.put("target", rest.trim());
        return command;
    }

    private static Command window(String mode) throws Exception {
        Command command = new Command();
        command.remote = "am.apps";
        command.action = "__window";
        command.args.put("mode", mode);
        return command;
    }

    private static Command procs() throws Exception {
        Command command = new Command();
        command.remote = "am.system";
        command.action = "__procs";
        command.args.put("count", 8);
        return command;
    }

    private static Command status() throws Exception {
        Command command = new Command();
        command.remote = "am.system";
        command.action = "__status";
        return command;
    }

    private static Command clipboard(String rest) throws Exception {
        String value = rest == null ? "" : rest.trim();
        Command command = new Command();
        command.remote = "am.clipboard";
        command.action = "__clipboard";
        if (value.isEmpty() || value.equalsIgnoreCase("get")) {
            command.args.put("op", "get");
            return command;
        }
        if (value.toLowerCase(Locale.US).startsWith("set ")) {
            command.args.put("op", "set");
            command.args.put("text", value.substring(4));
            return command;
        }
        command.args.put("op", "set");
        command.args.put("text", value);
        return command;
    }

    private static Command browser(String rest) throws Exception {
        String value = rest == null ? "" : rest.trim().toLowerCase(Locale.US);
        if (value.isEmpty()) throw new IllegalArgumentException("Use: browser back|forward|refresh|home|search|newtab|closetab|address");
        switch (value) {
            case "back": return keys("browser_back");
            case "forward": return keys("browser_forward");
            case "refresh":
            case "reload": return keys("browser_refresh");
            case "stop": return keys("browser_stop");
            case "home": return keys("browser_home");
            case "search": return keys("browser_search");
            case "favorites": return keys("browser_favorites");
            case "newtab": return keys("ctrl+t");
            case "closetab": return keys("ctrl+w");
            case "address": return keys("ctrl+l");
            case "nexttab": return keys("ctrl+tab");
            default: throw new IllegalArgumentException("Unknown browser action: " + value);
        }
    }

    private static Command presentation(String rest) throws Exception {
        String value = rest == null ? "" : rest.trim().toLowerCase(Locale.US);
        if (value.isEmpty()) throw new IllegalArgumentException("Use: presentation start|end|next|previous|black");
        switch (value) {
            case "start": return keys("f5");
            case "end": return keys("esc");
            case "next": return keys("right");
            case "previous":
            case "prev": return keys("left");
            case "black": return keys("b");
            case "white": return keys("w");
            default: throw new IllegalArgumentException("Unknown presentation action: " + value);
        }
    }

    private static Command keyboard(String rest) throws Exception {
        if (rest == null || rest.trim().isEmpty()) throw new IllegalArgumentException("Use: keyboard text <text> or keyboard key <combo>");
        int space = firstSpace(rest);
        String kind = space < 0 ? rest.trim() : rest.substring(0, space).trim();
        String tail = space < 0 ? "" : rest.substring(space + 1).trim();
        if (kind.equalsIgnoreCase("text") || kind.equalsIgnoreCase("type")) return typed(tail, false);
        if (kind.equalsIgnoreCase("send")) return typed(tail, true);
        if (kind.equalsIgnoreCase("key") || kind.equalsIgnoreCase("keys")) return keys(tail);
        return typed(rest, false);
    }

    /** Syntax help used by the Tasker editor and the About dialog. */
    public static String helpText() {
        return "SCRIPTS\n"
                + "One command per line, run in order.\n"
                + "Blank lines and lines starting with # are skipped.\n"
                + "  open notepad\n"
                + "  wait 1.5        seconds (decimals allowed)\n"
                + "  text Hello from Tasker\n"
                + "  send adds Enter after the text\n"
                + "  waitms 250      milliseconds\n\n"
                + "PLAYBACK\n"
                + "  play, pause, toggle, resume, next, skip,\n"
                + "  previous, stop\n"
                + "VOLUME\n"
                + "  mute, unmute, volup, voldown, louder, quieter\n"
                + "  volume 0-100, volume up, volume down,\n"
                + "  volume get\n"
                + "POWER\n"
                + "  lock, screenoff, monitoroff, sleep, restart,\n"
                + "  shutdown\n"
                + "TEXT\n"
                + "  text <text>, type <text>, send <text>\n"
                + "KEYS\n"
                + "  key|keys|press|combo <combo>, e.g. ctrl+alt+del\n"
                + "  enter, esc, backspace, tab, alttab, copy,\n"
                + "  paste, undo, redo\n"
                + "HOLD / RELEASE\n"
                + "  hold alt        press alt and keep it down\n"
                + "  hold ctrl+shift\n"
                + "  release alt     let it go again\n"
                + "  (keydown, keyup and unhold mean the same)\n"
                + "  alt-tab: hold alt / key tab / release alt\n"
                + "MOUSE\n"
                + "  click, rightclick, doubleclick, middleclick,\n"
                + "  scrollup, scrolldown, drag (hold),\n"
                + "  drop (release), pointer <op> [JSON]\n"
                + "APPS\n"
                + "  open|launch|app <app>, e.g. notepad, calc,\n"
                + "  settings, taskmgr, steam://...\n"
                + "SYSTEM\n"
                + "  procs, processes, status, clipboard get,\n"
                + "  clipboard set <text>, clipboard <text>\n"
                + "WINDOWS\n"
                + "  close, maximize, minimize, taskview, desktop\n"
                + "BROWSER\n"
                + "  browser back, forward, reload, stop, home,\n"
                + "  search, favorites, newtab, closetab, address,\n"
                + "  nexttab\n"
                + "SLIDES\n"
                + "  presentation start, end, next, previous,\n"
                + "  black, white\n"
                + "DIRECT\n"
                + "  <remote>.<action> [text or JSON], e.g.\n"
                + "  am.media.__media {\"key\":\"next\"}\n"
                + "  {\"remote\":\"am.media\",\"action\":\"__media\",...}";
    }
}
