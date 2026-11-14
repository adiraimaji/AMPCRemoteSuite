# Reverse-engineering notes

These notes record what was observed while studying the installed **Unified
Remote 3** Windows server, and how those observations shaped **AM PC Remote**.
They are provided for interoperability research and to document that AM PC Remote
is an independent implementation, not a copy.

## Scope and method

The installed product was examined in October 2026 on Windows using:

- **REA MCP** for artifact inventory, binary metadata/strings, and controlled
  browser observation of the vendor web UI.
- **Process and socket inspection** (`Get-Process`, `Get-NetTCPConnection`,
  `Get-NetUDPEndpoint`) to see which ports the running server owns.
- **Shipped data files**: the server's installed remote definitions (XML layouts
  and Lua action scripts), configuration, logs, and the Manager client
  JavaScript served to the local browser UI.
- **Runtime observation** of the local Manager page and its HTTP calls.

No vendor source code was available, and no vendor code or assets were copied
into this project.

### What could not be done

Deeper decompilation of `RemoteServerWin.exe` was not completed: the native
decompiler provider was unavailable in the session (`provider_unavailable`;
Ghidra Java probe timed out even though `rea doctor` reported healthy). The
binary was inspected with REA's `open_binary`/`binary_session` metadata views and
string extraction, and the protocol observations below come from runtime traffic
and shipped scripts rather than from decompiled functions. This is why AM PC
Remote does **not** claim wire compatibility.

## Artifact facts

| Item | Observed value |
| --- | --- |
| Install directory | `C:\Program Files (x86)\Unified Remote 3` |
| Main server binary | `RemoteServerWin.exe` |
| Binary size | 3,243,584 bytes |
| SHA-256 | `f081699c2ee2d8793490454b0a9fd496741e51e62398026b569b07bea2c50a58` |
| Manager UI | TCP 9510, loopback only |
| Client API | TCP 9512 |
| Discovery | UDP 9511 and UDP 9512 |
| Manager endpoints | `/client/connect`, `/client/request`, `/client/event`, `/client/disconnect` |
| Handshake version | 10 |
| Packet action range | `DataPacketAction` values 0–12 |

The Manager UI is a local browser application: the server serves HTML/JS on
loopback, and that JavaScript talks to the same server over HTTP. The phone apps
use the TCP 9512 API and UDP discovery; they do not use the Manager page.

## Observed architecture

The installed product separates:

1. **A Windows service/process** that owns input, screen capture, media, and
   power integration.
2. **Remote packages on disk** containing an XML layout for the phone UI and Lua
   action handlers for behavior. Layout and behavior are therefore data-driven
   and extensible without rebuilding the server.
3. **A local Manager web UI** for pairing/status, bound to loopback.
4. **LAN discovery** over UDP, with the HTTP/TCP API used after discovery.

The protocol is a versioned handshake followed by typed packets; the
`DataPacketAction` values cover connection, request/response, event, and
disconnect-style operations. Exact per-value semantics were not recovered.

## Design decisions in AM PC Remote

AM PC Remote keeps the *useful shape* of that architecture while using an
original stack:

| Concern | Unified Remote 3 (observed) | AM PC Remote (original) |
| --- | --- | --- |
| Server runtime | Native Windows executable | Node.js (zero npm dependencies) |
| Phone transport | Custom TCP/UDP protocol | HTTP + JSON + Server-Sent Events |
| Discovery | UDP 9511/9512 | UDP 9601, JSON reply |
| Remote definitions | XML layout + Lua actions | JSON layout + JSON action schema |
| UI delivery | Vendor phone apps | Installable PWA served by the PC |
| Pairing | Vendor pairing flow | 6-digit PIN + nonce proof + HMAC token |
| Input | Native Win32 integration | PowerShell-hosted C# P/Invoke helper |
| Admin | Local Manager UI on 9510 | Loopback-only `/admin` on 9600 |

Deliberate differences:

- **No wire compatibility.** AM PC Remote uses different ports (9600/9601), a
  different handshake, different packet formats, and its own token scheme. A
  vendor phone app cannot talk to it, and AM PC Remote clients cannot talk to a
  vendor server.
- **No vendor data reuse.** The ten remotes were authored from scratch as JSON.
  Icons are emoji/text; no vendor images, layouts, Lua scripts, or strings are
  redistributed.
- **Web-first client.** Instead of native apps, the PC serves a PWA that works in
  any modern mobile browser and can be installed to the home screen.
- **Explicit security boundary.** Pairing is rate-limited and revocable, tokens
  are server-side revocable, and the admin surface is loopback-only.

## Behavior that informed features

Observed capabilities that motivated the feature set:

- Trackpad-style relative pointer movement with tap, drag, and two-finger scroll.
- Live screen preview with tap-to-click.
- Media transport and system volume control.
- App launcher entries and power controls.
- Per-remote layouts with a small set of reusable widget types.
- Local pairing/status management with connected-client visibility.

AM PC Remote implements these with its own widgets (`button`, `slider`, `input`,
`trackpad`, `screen`, `status`, `stat`, `procs`) and action types documented in
the README.

## Security observations

- The vendor Manager UI bound to loopback, so remote LAN devices could not open
  it directly. AM PC Remote follows the same boundary: `/admin` and
  `/api/admin/*` reject non-loopback clients.
- LAN protocols that predate TLS generally assume a trusted network. AM PC Remote
  keeps that assumption explicit: HTTP only, PIN pairing, revocable bearer
  tokens, and a warning not to expose the port to the internet.
- Discovery replies reveal the server name, id, version, HTTP port and whether a
  PIN is required. They do not reveal the PIN or tokens.
- A remote-control server is equivalent to local input access. Pairing therefore
  grants full control; there is no per-remote authorization in this version.

## Reproducing the observations

The following are safe, read-only checks on a machine with the vendor product
installed:

```powershell
Get-ChildItem 'C:\Program Files (x86)\Unified Remote 3' -Recurse -File |
  Measure-Object -Property Length -Sum

Get-FileHash 'C:\Program Files (x86)\Unified Remote 3\RemoteServerWin.exe' -Algorithm SHA256

Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -in 9510,9511,9512 } |
  Select-Object LocalAddress,LocalPort,OwningProcess

Get-NetUDPEndpoint |
  Where-Object { $_.LocalPort -in 9511,9512 } |
  Select-Object LocalAddress,LocalPort,OwningProcess
```

Do not run disruptive tests against a production installation. AM PC Remote's
own tests use a mock native host so that no keystrokes, clicks, clipboard
changes, or power commands reach the desktop.

## Clean-room statement

The implementation in this repository was written from functional observations,
public protocol behavior visible at runtime, and the general concept of a
phone-to-PC remote. It contains no decompiled vendor code, no copied Lua or XML,
no vendor assets, and no vendor protocol constants beyond factual identifiers
needed to describe what was observed (ports, endpoint names, version number,
binary hash). "Unified Remote" is a trademark of its respective owner; this
project is unaffiliated.
