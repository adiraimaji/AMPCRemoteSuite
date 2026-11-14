# AM PC Remote

Control a Windows PC from your phone over your local network. AM PC Remote is a
small, self-hosted remote-control server: it serves a mobile web app from the PC,
drives mouse, keyboard, media, volume, clipboard, screenshots and power state
through Win32 APIs, and does not need an account, cloud service, or internet
connection.

It was built as an original, functionally similar alternative to commercial
phone-remote software. No code, assets, protocol payloads, or remote definitions
from Unified Remote are included. See [docs/reverse-engineering.md](docs/reverse-engineering.md)
for the observations that informed the design and for the deliberate differences.

## Features

- **10 built-in remotes**: Trackpad, Keyboard, Media, Screen, Apps, System,
  Clipboard, Presenter, Browser, Power.
- **Trackpad gestures**: tap to click, two-finger tap for right click,
  three-finger tap for middle click, two-finger scroll, **double-tap drag** and
  press-and-hold drag (like a laptop touchpad), and optional absolute touchpad
  mode.
- **Unicode keyboard input** using `SendInput` with UTF-16 scan codes, so
  non-Latin text works without changing the PC keyboard layout.
- **Live typing** in the Trackpad and Keyboard remotes: the phone keyboard
  streams every key press straight to the PC, with no Send button. On the
  Trackpad the phone keyboard is summoned from the ⌨ action-bar button, so the
  typing strip no longer takes screen space.
- **Modifier-aware typing**: latched Ctrl / Shift / Alt / Win apply to the phone
  keyboard as well, so Ctrl + `a` selects on the PC, Shift + typing gives
  capitals, and Shift + Tab walks backwards.
- **Special-key panel** on Trackpad and Keyboard: sticky Ctrl / Shift / Alt / Win
  modifiers (combos like Ctrl+Shift+Esc), a hold-to-repeat Tab, a plain Win key,
  Esc, Tab, Enter, Bksp, Del, Ins, Home, PgUp, PgDn, End, Spc, an arrow cluster
  and F1–F12. Hidden by default behind the ⌦ action-bar button; it shows the
  first three rows at full size and scrolls for the rest, so the touchpad stays
  large.
- **Pointer/scroll speed** adjustable from the in-app Settings sheet and saved
  on the phone.
- **Live PC status** over Server-Sent Events (CPU, memory, battery, volume,
  foreground window) plus a screenshot stream.
- **PIN pairing** with a one-time nonce proof, HMAC-signed bearer tokens, per-IP
  rate limiting, and device revocation.
- **PWA-ready phone UI**: installs to the home screen, responsive dark theme,
  no external fonts or CDN dependencies.
- **Config-driven apps and remotes**; add a remote by dropping a JSON file into
  `remotes/`.
- **Optional auto-start and firewall setup** with `install.ps1`.

## Requirements

- Windows 10 or 11 (the input bridge uses Win32 P/Invoke and Core Audio).
- PowerShell 5.1 (included with Windows).
- Phone and PC on the same Wi-Fi/LAN.
- Node.js 20 or newer **only** when running from source or building the EXE.
  The standalone `AM PC Remote.exe` includes its own Node runtime.

> The native bridge starts a hidden PowerShell process and compiles a small C#
> helper on first use, which can take a few seconds. The HTTP server starts
> immediately and retries the bridge on demand.

## Quick start

### Standalone EXE (easiest)

Double-click:

```text
dist\AM PC Remote.exe
```

No Node.js installation is required on that PC. The first launch unpacks the
application files to:

```text
%LOCALAPPDATA%\AM PC Remote\app
```

and opens the admin page in your browser. The PIN, paired devices and config
live in that folder and survive upgrades; only `config.json` is left untouched
when a new build is unpacked.

Command-line options:

```powershell
& '.\dist\AM PC Remote.exe'            # start and open the admin page
& '.\dist\AM PC Remote.exe' --no-open  # start without opening a browser
& '.\dist\AM PC Remote.exe' pin        # show the current PIN
& '.\dist\AM PC Remote.exe' pin new    # rotate the PIN and sign out all devices
& '.\dist\AM PC Remote.exe' --version
```

The EXE is unsigned, so Windows SmartScreen may show "Windows protected your PC"
on first run. Choose **More info → Run anyway**. You can also right-click the EXE
and create a desktop shortcut, or point `install.ps1`-style startup shortcuts at
it.

### From source

```powershell
cd am-pc-remote
.\start.ps1
```

or:

```powershell
npm start
```

The console prints the addresses:

```text
PC admin : http://localhost:9600/admin
Phone    : http://192.168.1.101:9600
PIN      : 123456
```

Open the phone URL, enter the PIN, and tap a remote. The PIN is also visible on
the PC admin page, where you can rotate it, disable pairing, and revoke devices.
The admin page is restricted to loopback connections from the PC itself.

### Build the standalone EXE

On a machine with Node.js and npm:

```powershell
npm install
npm run build:exe
```

This produces `dist\AM PC Remote.exe` using Node's Single Executable Application
support. The server, web UI, remotes and native helper are embedded; the EXE
unpacks them at launch. `postject` and `rcedit` are dev-only dependencies used
for injection, the icon and version metadata. Rebuild after changing any source,
remote or web file.

### Install for auto-start

```powershell
# Run from an elevated PowerShell prompt
.\install.ps1
```

This creates a Startup shortcut (`AM PC Remote.lnk`) that runs `start.ps1`, and
adds inbound firewall rules for TCP 9600 and UDP 9601. Use `.\install.ps1 -Remove`
to undo both. To auto-start the standalone build instead, create a shortcut to
`dist\AM PC Remote.exe` in `shell:startup`.

### Change the PIN from the command line

```powershell
node src/server.js pin        # source build
node src/server.js pin new    # rotate the PIN and sign out all devices

& '.\dist\AM PC Remote.exe' pin       # standalone EXE
& '.\dist\AM PC Remote.exe' pin new
```

## Remotes

| Remote | What it does |
| --- | --- |
| Trackpad | Full-size pointer surface, double-tap or hold to drag, two-finger right click, three-finger middle click, action-bar ⌨ keyboard and ▦ special-key buttons |
| Keyboard | Live typing strip, text block compose, ▦ special-key panel (modifiers, nav, F1–F12) |
| Media | Play/pause, next/previous, stop, volume slider and mute |
| Screen | Live JPEG view, click-to-control, show desktop |
| Apps | Launch allow-listed apps and Windows pages |
| System | CPU/memory/battery/uptime, top processes, lock screen |
| Clipboard | Read the PC clipboard, send text from the phone |
| Presenter | Next/previous slide, black screen, start/end presentation |
| Browser | Back/forward, tabs, address bar, zoom, fullscreen |
| Power | Lock, screen off, sleep, restart, shut down (with confirmation) |

Destructive power actions require a confirmation dialog on the phone and an
explicit `confirm: true` argument before the server forwards them.

## Configuration

`config.json` is read at startup:

| Key | Default | Meaning |
| --- | --- | --- |
| `name` | `AM PC Remote` | Display name in the UI and discovery replies |
| `port` | `9600` | HTTP/SSE port |
| `discoveryPort` | `9601` | UDP discovery port |
| `requirePin` | `true` | Require the PIN for new pairings |
| `broadcast` | `true` | Answer UDP discovery probes |
| `broadcastIntervalMs` | `15000` | Status/keepalive broadcast interval |
| `allowPower` | `true` | Allow lock/sleep/restart/shutdown |
| `tokenDays` | `30` | Bearer-token lifetime (1–365) |
| `screen.maxWidth` | `1280` | Screenshot downscale width |
| `screen.quality` | `55` | JPEG quality (1–100) |
| `screen.minIntervalMs` | `350` | Minimum gap between captures |
| `apps` | see file | Allow-listed launch targets (`id`, `name`, `target`) |
| `allowedPaths` | `C:\Users\Public` | Directories that `__open` may launch from |

`apps[].target` may be an executable name, an `https://` URL, a Windows URI
(`ms-settings:`, `shell:`, ...), or an absolute path inside `allowedPaths`.

## Adding a remote

Create `remotes/myremote.json`:

```json
{
  "id": "am.myremote",
  "name": "My Remote",
  "icon": "⭐",
  "color": "#f59e0b",
  "description": "A custom layout",
  "layout": {
    "type": "grid",
    "rows": [
      {
        "weight": 1,
        "children": [
          { "type": "button", "text": "Mute", "icon": "🔇", "action": "__volume", "args": { "op": "mute" } }
        ]
      }
    ]
  },
  "actions": {}
}
```

Layout nodes:

- `button` — `text`, `icon`, `action`, `args`, plus optional `primary`, `danger`,
  `compact`, `confirm`, `needsInput` (send `state.inputs[name]` as `args.text`),
  `fillsInput` (put an action result's `text` into an input).
- `slider` — `label`, `action`, `args`; sends `{ value }` continuously.
- `input` — `id`, `placeholder`, `multiline`; value is available to buttons via
  `needsInput`.
- `trackpad` — pointer surface with tap/scroll/right-click gestures and
  press-and-hold drag.
- `specialKeys` — scrollable panel of modifier keys (sticky Ctrl/Shift/Alt/Win),
  a hold-to-repeat Tab, a plain Win key, navigation keys, an arrow cluster and
  F1–F12.
- `keysToggle` — button that shows/hides the `specialKeys` row. Put it in
  `layout.tools` to render it in the action bar.
- `keyboardToggle` — action-bar button that focuses a live input to raise the
  phone keyboard. When a layout uses it without its own `liveInput`, the UI adds
  a 1px hidden field so typing still streams to the PC.
- `screen` — live screenshot with optional click-to-control.
- `status` / `stat` / `procs` — read-only status widgets.
- `row` / `grid` — container and weighted rows. Rows accept `weight` (flex
  share) or `fixed` (exact height in px, also used by the keys panel),
  `className`, and children accept `grow` and `className`.
- `layout.tools` — optional array of nodes (`keysToggle`, `keyboardToggle`)
  rendered into the action bar instead of the body.

A remote's `actions` object maps names to definitions. Definitions can be a
single key string or one of the action types below. Built-in actions are called
directly by name and receive the button's `args`.

### Built-in actions

| Action | Arguments |
| --- | --- |
| `__keys` | `keys: ["ctrl+t"]` or `key: "f5"` |
| `__pointer` | `op`: `move`, `moveabs`, `scroll`, `scrollh`, `down`, `up`, `click`, `doubleclick`, `rightclick`, `middleclick`, `clickat`; `dx`, `dy`, `x`, `y`, `button` |
| `__text` | `text` |
| `__volume` | `op`: `get`, `set`, `up`, `down`, `mute`; `value` |
| `__power` | `mode`: `lock`, `monitoroff`, `sleep`, `restart`, `shutdown`; `confirm` |
| `__open` | `target` (app id, allowed path, URL, or Windows URI) |
| `__window` | `mode`: `switch`, `close`, `desktop`, `taskview`, `maximize`, `minimize`, `lock` |
| `__clipboard` | `op`: `get` or `set`; `text` |
| `__procs` | `count` (1–20) |
| `__status` | none |
| `__media` | `key`: `playpause`, `next`, `prev`, `stop` |
| `__sequence` | `steps: [{ type, ... , delay }]` |
| `__noop` | none |

Key names cover letters, digits, `f1`–`f24`, arrows, navigation keys, media keys,
browser keys, numpad keys, punctuation (`equals`, `minus`, `comma`, `period`,
`slash`, `backslash`, `quote`, `bracketleft`, `bracketright`, `semicolon`,
`backtick`, `plus`), and modifier combos such as `ctrl+shift+t` or `win+d`.
Arguments are whitelisted per built-in, so a client cannot change the action
type by sending extra fields.

### Remote-defined action types

`keys`/`key`, `text`/`type`, `media`, `volume`, `pointer`, `open`/`launch`,
`power`, `clipboard`, `window`, `status`, `procs`, `sequence`, `wait`, `noop`.

Example macro:

```json
"actions": {
  "openAndSearch": {
    "type": "sequence",
    "steps": [
      { "type": "keys", "keys": ["ctrl+l"], "delay": 150 },
      { "type": "text", "text": "weather", "enter": true }
    ]
  }
}
```

## HTTP API

All authenticated routes accept `Authorization: Bearer <token>` (the web app
also accepts `?token=` for the screenshot stream).

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Liveness and version |
| GET | `/api/hello` | Server identity, nonce, lockout state |
| POST | `/api/auth` | Exchange nonce + `sha256(nonce:pin)` for a token |
| GET | `/api/events` | SSE stream: hello, status, actions, clients |
| GET | `/api/remotes` | Remote summaries |
| GET | `/api/remotes/:id` | Full remote layout |
| GET | `/api/state` | Status snapshot |
| POST | `/api/action` | `{ remote, action, args }` |
| GET | `/api/screen.jpg` | Current screenshot (JPEG) |
| GET | `/api/clients` | Paired devices |
| POST | `/api/logout` | Revoke the calling device |
| GET | `/admin` | PC-only admin page (loopback) |

UDP 9601 answers discovery probes with the server name, id, version, HTTP port
and pairing flag.

## Security notes

- Pairing uses a 6-digit PIN, a 60-second single-use nonce, and
  `SHA-256(nonce:pin)` proof. Tokens are `id.expiry.HMAC-SHA256` and are stored
  server-side so they can be revoked.
- Eight failed attempts from one IP lock pairing for five minutes.
- The admin page and admin API are loopback-only; a phone on the LAN cannot open
  them even with a valid token.
- App launches and file targets are allow-listed. Power actions are opt-out via
  `allowPower` and destructive modes require explicit confirmation.
- Traffic is HTTP on the LAN, not TLS. Do not expose port 9600 to the internet;
  use a trusted private network or a VPN. The PIN and bearer tokens are only as
  private as that network.
- `data/` contains the PIN, HMAC secret, paired-device list and temporary
  screenshots. It is excluded by `.gitignore` and should be treated as secret.
  In the standalone build it lives in `%LOCALAPPDATA%\AM PC Remote\app\data`.
- Anyone who can pair can control the PC. Disable pairing after pairing your
  devices, or revoke devices from `/admin`.

## Tests

```powershell
npm test                 # action, remote definition and settings tests (mock native host)
node test/actions-test.mjs
node test/remotes-test.mjs
node test/util-test.mjs
node test/native-smoke.mjs   # native bridge: ping, status, volume, clipboard, screenshot
node test/server-smoke.mjs   # end-to-end HTTP test, needs a running server
```

The action tests never touch the real desktop: they use a recording mock for the
native bridge, which keeps keystrokes and power commands out of your session.

## Project layout

```text
am-pc-remote/
  config.json           runtime configuration
  start.ps1             start in the current console
  install.ps1           startup shortcut + firewall rules
  src/
    server.js           HTTP, SSE, UDP discovery, admin page
    auth.js             PIN nonce pairing, HMAC tokens, pairing state
    native.js           long-lived JSON-lines PowerShell bridge
    actions.js          key parsing + action dispatch
    remotes.js          remote JSON loader and summaries
    util.js             paths, JSON helpers, logging
  native/InputHost.ps1  Win32/Core Audio input, status, screenshot, clipboard
  remotes/              ten JSON remote definitions
  web/                  phone PWA (HTML/CSS/JS, manifest, service worker)
  build-exe.mjs         EXE build script
  sea-main.cjs          executable bootstrapper (embedded in the EXE)
  make-icon.ps1         icon generator
  dist/                 build output: AM PC Remote.exe (git-ignored)
  test/                 action, native and end-to-end tests
  data/                 generated secrets and settings (git-ignored)
```

## Troubleshooting

- **"Native input is only available on Windows."** Run the server on Windows.
- **First action is slow.** The C# helper is compiling; later actions are fast.
- **Phone cannot connect.** Check that the PC firewall allows TCP 9600, that both
  devices are on the same subnet, and that the phone is using the printed LAN IP
  rather than `localhost`.
- **Screenshot is stale or black.** The server throttles captures; on locked or
  secure desktops Windows may return a black frame by design.
- **Wrong PIN / locked out.** Read the PIN from the console or `/admin`; wait five
  minutes or restart the server to clear the in-memory lockout.
- **Port already in use.** Stop the old process (`Get-NetTCPConnection -LocalPort
  9600 -State Listen`) or change `port` in `config.json`. The EXE detects this and
  offers to open the admin page instead of exiting silently.
- **The EXE closes immediately.** A second copy is probably already running, or
  port 9600 belongs to another program. Run it from a PowerShell window to see
  the message.
- **SmartScreen warning.** The EXE is unsigned. Use **More info → Run anyway**, or
  sign the binary with your own code-signing certificate.
- **Where are the EXE settings?** `%LOCALAPPDATA%\AM PC Remote\app\config.json`
  and `%LOCALAPPDATA%\AM PC Remote\app\data\`.

## License and attribution

This is an independent implementation for personal use. "Unified Remote" is a
trademark of its respective owner; this project is not affiliated with or
endorsed by it. All source in this repository was written for AM PC Remote.
