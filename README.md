# AM PC Remote Suite 1.0.0

**Initial release.** AM PC Remote is a two-part remote-control suite for your own
local network: a Windows server and a matching Android app. The phone controls
the PC over Wi-Fi or Ethernet – no account, no cloud service, and no internet
access are required.

Both components are version **1.0.0**:

* **AM PC Remote Server 1.0.0** – Windows tray application and HTTP/UDP server
* **AM PC Remote 1.0.0** – Android app (`com.adiraimaji.ampcremote`)

## Release 1.0.0

This first release introduces the complete suite:

* Automatic PC discovery on the local network and PIN-based pairing
* Touchpad, live keyboard, and on-screen special-key panel
* Screen view with remote clicking
* Media, volume, power, app, window, clipboard, browser, and presentation commands
* Live system status and top-process list
* Tasker action plugin, broadcast commands, and status queries
* Scripted multi-command automation with key hold/release support
* A Windows single-file EXE and an Android APK built without Gradle

## What is in the suite

```
AM-PC-Remote-Suite-Release\
  windows\            server (Node.js source + single-file EXE)
    build-exe.mjs     EXE build script
    sea-main.cjs      executable bootstrapper
    make-icon.ps1     icon generator
    dist\AM PC Remote.exe
  android\            native Android app (discovery, pairing, WebView shell, Tasker)
    build.ps1         Windows build script
    build.sh          Termux/Linux build script
    make-icons.ps1    launcher icon generator
    keystore.properties.example
    android.jar       (optional local platform jar)
    dist\AM-PC-Remote-1.0.0.apk
```

## Requirements

* **PC:** Windows 10 or 11 on the same network as the phone
* **Phone:** Android 6.0 (API 23) or newer
* **Network:** Both devices on the same LAN; ports **9600/TCP** and **9601/UDP**
  must be reachable
* **Build tools:** Node.js 20+ for the Windows EXE; JDK 17+ and Android build
  tools for the APK

## Quick start

1. **PC** – start `windows\dist\AM PC Remote.exe`. It runs without a console
   window and appears in the notification area (tray). Right-click the tray icon
   for *Open admin page, Show PIN, Rotate PIN, Firewall rules, Start with
   Windows, Data folder, Restart, Stop*.
2. **Phone** – install `android\dist\AM-PC-Remote-1.0.0.apk` and open
   **AM PC Remote**. The app finds the server by itself over UDP 9601, so there
   is no IP address to type.
3. Tap the PC card, enter the 6-digit PIN shown on the PC (also available from
   the tray menu and at `http://localhost:9600/admin`), and pair. The phone keeps
   the token, so later sessions only need a tap.

The suite ships as a Windows EXE and an Android APK; both can also be rebuilt
from source, see [Build from source](#build-from-source).

## Trackpad and live typing

The **Trackpad** screen keeps the touchpad front and centre.

* **Title-bar buttons** – **⌨** opens the phone keyboard for live typing and
  **▦** shows or hides the special-key panel. The active PC window is shown
  under the title.
* **Special-key panel** – opens below the title bar with three rows; the arrows
  and F1–F12 scroll below. The first row holds keys down on the PC: Ctrl, Shift,
  Alt, and Win stay pressed until tapped again. Alt + **Tab** therefore keeps
  Windows' Alt-Tab switcher open, and each Tab moves the highlight until Alt is
  tapped again. A second **Tab** repeats while held.
* **Edit and navigation rows** – Esc, Tab, Enter, Bksp, a one-shot Win (Start
  menu), Del, Ins, Home, PgUp, PgDn, End, Spc, an arrow cluster (↑ over ← ↓ →),
  and F1–F12.
* **Touchpad** – tap for a left click, **two-finger tap** for a right click, and
  **three-finger tap** for a middle click. To drag, double-tap and keep the
  finger down, or press and hold, then move. Two fingers scroll.
* **Live typing** – press **⌨** and the phone keyboard opens. Every key is sent
  to the PC immediately, character by character; there is no Send button.
  Backspace deletes on the PC, Enter sends Enter, Tab sends Tab, and typing keeps
  working while the trackpad is used.

## Keyboard screen

The **Keyboard** screen has the same special-key panel and a large text box for
pasting or composing a block of text, with **Send text**, **Copy**, and **Paste**
buttons. It also has its own live typing strip at the bottom.

The **⋯** menu opens **Settings**, where *Pointer speed* and *Scroll speed* tune
how far the cursor and the page move for the same swipe (0.6x – 3x). The values
are stored on the phone.

Commands are queued one at a time, so fast typing arrives in the correct order.

## Screen, system, and media

* **Screen** – shows a live view of the PC screen and turns taps into clicks,
  with dedicated left-click, right-click, and Show desktop buttons.
* **System** – displays CPU, memory, battery, idle time, the active window, and
  the top processes, with quick access to Task Manager.
* **Media and volume** – play/pause, next/previous, stop, mute, and volume up or
  down.
* **Power** – lock, turn off the display, sleep, restart, or shut down the PC.
* **Apps and windows** – open common apps or paths, close/maximize/minimize
  windows, show the task view, or show the desktop.
* **Clipboard and browser** – read or set the PC clipboard and drive the browser
  (back, forward, reload, tabs, address bar, favourites).
* **Presentations** – start/end a slideshow, move forward or back, and toggle a
  black or white screen.

## Tasker and automation

* **Action plugin** – in Tasker: *Action → Plugin → AM PC Remote → Command*.
  One command per line; every line is sent in order, blank lines and `#`
  comments are skipped, and `wait` / `waitms` pause on the phone.
* **Broadcast** – any automation can drive the PC with
  `com.adiraimaji.ampcremote.COMMAND`, extras `cmd` / `value` (and `token`,
  `host`, `port` when not paired yet). `cmd` may hold a whole script. A result
  broadcast `com.adiraimaji.ampcremote.RESULT` reports `ok` / `error` plus
  `steps` and `elapsedMs`.
* **Query** – `com.adiraimaji.ampcremote.QUERY` returns server status.

### Scripts

One command per line, run one by one:

```
# presentation warm-up
open notepad
wait 1.5
text Hello from Tasker
send this line presses Enter
key ctrl+s
waitms 250
key enter
```

`wait <seconds>` accepts decimals (`wait 0.5`); `waitms <ms>` takes
milliseconds. Both run on the phone and are never sent to the PC. Execution is
sequential and stops at the first failing line; the error names the line
(`Line 3: Unknown command: xyz`). To type text containing a newline, use the
JSON form on a single line:

```
am.keyboard.__text {"text":"line one\nline two"}
```

Hold a key down, use it, then release it – for example Alt-Tab through windows:

```
hold alt
key tab
waitms 300
key tab
release alt
```

`hold <key>` keeps it down (`hold alt`, `hold ctrl+shift`); `release <key>` lets
it go again (`keydown` / `keyup` / `unhold` are the same). A key still held when
the script ends stays held, so a following Tasker action can continue using it.
If a line fails, the app releases everything it was holding.

`key alttab` (or `key alt+tab`) is a complete tap: it switches once and closes
the switcher. To keep the switcher open and step through windows, use
`hold alt` followed by `key tab` for each step. The trackpad's ▦ panel behaves
the same way: tap **Alt**, tap **Tab** as often as needed, then tap **Alt**
again.

### Commands

| Group | Commands |
| --- | --- |
| Playback | `play`, `pause`, `toggle`, `resume`, `next`, `skip`, `previous`, `prev`, `stop` |
| Volume | `mute`, `unmute`, `volup`, `voldown`, `louder`, `quieter`, `volume 0-100`, `volume up`, `volume down`, `volume mute`, `volume get` |
| Power | `lock`, `screenoff`, `monitoroff`, `sleep`, `restart`, `shutdown` |
| Text | `text <text>`, `type <text>`, `send <text>` (send also presses Enter) |
| Keys | `key <combo>`, `keys <combo>`, `press <combo>`, `combo <combo>` (e.g. `ctrl+alt+del`, `win+d`), `enter`, `esc`, `backspace`, `tab`, `alttab`, `copy`, `paste`, `undo`, `redo` |
| Hold / release | `hold <key>` (keeps it down: `hold alt`, `hold ctrl+shift`), `release <key>`, also `keydown`, `keyup`, `unhold` |
| Mouse | `click`, `rightclick`, `doubleclick`, `middleclick`, `scrollup`, `scrolldown`, `drag` (button down), `drop` (button up), `pointer <op> [JSON]` |
| Apps | `open <app>`, `launch <app>`, `app <app>` – `notepad`, `calc`, `settings`, `taskmgr`, a path, `steam://…` |
| System | `procs`, `processes` (top 8 by memory), `status`, `clipboard get`, `clipboard set <text>`, `clipboard <text>` |
| Windows | `close`, `maximize`, `minimize`, `taskview`, `desktop` |
| Browser | `browser back`, `forward`, `reload`, `stop`, `home`, `search`, `favorites`, `newtab`, `closetab`, `address`, `nexttab` |
| Slides | `presentation start`, `end`, `next`, `previous`, `black`, `white` |
| Direct | `<remote>.<action> [text or JSON]` – e.g. `am.media.__media {"key":"next"}`, or a raw `{"remote":…,"action":…,"args":{…}}` line |
| Script only | `wait <seconds>`, `waitms <milliseconds>` |

## Security

* PIN pairing with a nonce challenge, HMAC-signed tokens, rate limiting, and
  per-device revocation. Rotating the PIN in the tray/admin page signs out every
  paired phone.
* Everything stays on the LAN; only ports **9600/TCP** (HTTP) and **9601/UDP**
  (discovery) are used.
* The packaged EXE stores its PIN in
  `%LOCALAPPDATA%\AM PC Remote\app\data\settings.json`, paired devices in
  `clients.json`, and the activity log in `server.log`. A source build keeps the
  same files under `windows\data`.

### Firewall note

The first time the EXE runs, Windows may ask about network access. If the prompt
is answered *Cancel*, Windows silently creates a **Block** rule and the phone
will time out connecting. The tray menu item **Firewall rules** deletes stale or
blocking `AM PC Remote` rules and adds program-scoped allow rules for the current
EXE path on both TCP 9600 and UDP 9601.

## Build from source

All build helpers live directly in each project's root folder.

### Windows EXE

```powershell
cd windows
npm install
npm run check
npm test
npm run build:exe
```

This produces `windows\dist\AM PC Remote.exe`. The build embeds the web UI,
remotes, and PowerShell helpers into a Node single executable and switches it to
the Windows GUI subsystem so no console window appears.

### Android APK

```powershell
cd android
.\build.ps1
```

This produces `android\dist\AM-PC-Remote-1.0.0.apk`.

### Android signing

`android\build.ps1` and `android\build.sh` read signing values from
`android\keystore.properties`:

```properties
# Copy keystore.properties.example to keystore.properties and edit it.
storeFile=keystore.jks
storePassword=change-me
keyAlias=amtrainplanner
keyPassword=change-me
```

`storeFile` may be a file name (resolved next to the script) or an absolute path,
so the keystore can be renamed or moved freely. `keystore.properties` and all
`*.jks` files are git-ignored.

The build scripts look for the platform jar in this order: `ANDROID_JAR`, the
`SDK` environment variable (a jar file or an SDK folder), a local
`android\android.jar`, then `ANDROID_HOME` / `ANDROID_SDK_ROOT`.

### Build in Termux

Copy `android.jar` into the `android` folder (or pass its path with `SDK`), fill
in `keystore.properties`, install the tools, and run the shell build:

```sh
pkg install openjdk-17 aapt2 d8 apksigner zip findutils
cd android
sh build.sh
# or with an explicit platform jar:
SDK=/path/to/android.jar sh build.sh
```

`zipalign` is used when present but is optional for sideloading. `INSTALL=1 sh
build.sh` installs over adb afterwards. The script also accepts `ANDROID_HOME`,
`BUILD_TOOLS`, and per-tool overrides such as `AAPT2`, `D8`, `APKSIGNER`,
`JAVAC`, and `JAR`.

### Publishing

Each project has its own `.gitignore`. Build output (`dist/`, `.build/`),
`node_modules/`, the signing keystore, `keystore.properties`, and the local
`android.jar` are excluded, so the repository can be published without secrets
or large generated files.

## Design note

The phone UI is served by the PC, so the web interface travels with
`AM PC Remote.exe`; the APK is the native shell for discovery, pairing, and
Tasker integration. Asset URLs carry a build stamp and the service worker is
network-first, so a phone with the page already open picks up the current UI on
its next launch.

## More details

* `windows\README.md` – server architecture, HTTP API, remote JSON format, and
  security model.
* `windows\docs\reverse-engineering.md` – functional comparison notes.
