import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import dgram from 'node:dgram';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  ROOT, DATA_DIR, WEB_DIR, VERSION, ensureDir, readJson, mimeFor, log, logError,
  initLogging, getLogFile, localIpList, isLoopback, timestamp
} from './util.js';
import {
  initAuth, newNonce, verifyPin, issueToken, verifyToken, touchClient,
  revokeClient, listClients, getPin, rotatePin, setRequirePin, pinRequired, authLocked
} from './auth.js';
import { NativeHost } from './native.js';
import { loadRemotes, getRemote, remoteSummaries } from './remotes.js';
import { executeAction } from './actions.js';

initLogging();

const CONFIG_FILE = path.join(ROOT, 'config.json');
const NATIVE_SCRIPT = path.join(ROOT, 'native', 'InputHost.ps1');
const TRAY_SCRIPT = path.join(ROOT, 'native', 'TrayIcon.ps1');
const TMP_DIR = path.join(DATA_DIR, 'tmp');
const API_VERSION = 2;
const PROTOCOL = 2;

const defaults = {
  name: 'AM PC Remote',
  port: 9600,
  discoveryPort: 9601,
  requirePin: true,
  broadcast: true,
  broadcastIntervalMs: 15000,
  allowPower: true,
  tokenDays: 365,
  tray: true,
  openAdminOnStart: true,
  screen: { maxWidth: 1280, quality: 55, minIntervalMs: 350 },
  apps: [],
  allowedPaths: []
};

function loadConfig() {
  const raw = readJson(CONFIG_FILE, {});
  return {
    ...defaults,
    ...raw,
    screen: { ...defaults.screen, ...(raw.screen || {}) }
  };
}

const config = loadConfig();
const serverName = config.name || 'AM PC Remote';
const serverPort = Number(config.port) || 9600;
const discoveryPort = Number(config.discoveryPort) || 9601;
const serverId = crypto.createHash('sha256').update(`${os.hostname()}|${serverName}`).digest('hex').slice(0, 12);
const startedAt = Date.now();
const standalone = process.env.AMPC_STANDALONE === '1';

ensureDir(DATA_DIR);
ensureDir(TMP_DIR);

// ---------------------------------------------------------------- CLI
const cli = process.argv.slice(2);
if (cli.includes('pin')) {
  initAuth(config, { quiet: true });
  if (cli.includes('new')) {
    const pin = rotatePin();
    console.log(`New pairing PIN: ${pin}`);
  } else {
    console.log(`Pairing PIN: ${getPin()}`);
  }
  process.exit(0);
}

initAuth(config);
loadRemotes({ reload: true });

const native = new NativeHost(NATIVE_SCRIPT);
native.start().catch((err) => {
  log(`Native input host unavailable: ${err.message}`);
});

// ---------------------------------------------------------------- SSE hub
const sseClients = new Set();

function broadcast(payload) {
  const frame = `data: ${JSON.stringify(payload)}\n\n`;
  for (const entry of sseClients) {
    try {
      entry.res.write(frame);
    } catch {
      sseClients.delete(entry);
    }
  }
}

function clientCount() {
  return sseClients.size;
}

setInterval(() => {
  for (const entry of sseClients) {
    try {
      entry.res.write(': ping\n\n');
    } catch {
      sseClients.delete(entry);
    }
  }
}, 20_000).unref();

// ---------------------------------------------------------------- helpers
function sendJson(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function bearer(req, url) {
  const header = req.headers.authorization || '';
  if (header.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return url.searchParams.get('token') || '';
}

function authenticate(req, url) {
  const client = verifyToken(bearer(req, url));
  if (client) touchClient(client.id);
  return client;
}

function hostIp(req) {
  const raw = req.socket.remoteAddress || '';
  return raw.replace(/^::ffff:/, '');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function phoneUrls() {
  return localIpList().map((ip) => `http://${ip}:${serverPort}`);
}

function openBrowser(url) {
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '', url], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }).unref();
    }
  } catch {
    /* best effort */
  }
}

function showMessageBox(title, message) {
  if (process.platform !== 'win32') {
    log(`${title}: ${message}`);
    return;
  }
  try {
    const safeTitle = String(title).replace(/'/g, "''");
    const safeMessage = String(message).replace(/'/g, "''");
    spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command',
      `Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('${safeMessage}','${safeTitle}') | Out-Null`
    ], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch {
    /* best effort */
  }
}

// ---------------------------------------------------------------- status
let lastStatus = null;
let statusBusy = false;

async function readStatus() {
  try {
    const status = await native.call('status', {}, 6000);
    lastStatus = { ...status, native: true, serverTime: new Date().toISOString() };
  } catch (err) {
    lastStatus = {
      ...(lastStatus || {}),
      native: false,
      error: err.message,
      serverTime: new Date().toISOString()
    };
  }
  return lastStatus;
}

async function pushStatus() {
  if (statusBusy) return;
  statusBusy = true;
  try {
    const status = await readStatus();
    broadcast({ type: 'status', status });
  } finally {
    statusBusy = false;
  }
}

setInterval(() => {
  if (clientCount() > 0) pushStatus();
}, 3000).unref();

// ---------------------------------------------------------------- screenshot
let screenBusy = null;
let lastScreenAt = 0;
const screenPath = path.join(TMP_DIR, 'screen.jpg');

async function captureScreen() {
  const now = Date.now();
  const minInterval = config.screen?.minIntervalMs || 350;
  if (screenBusy) return screenBusy;
  if (now - lastScreenAt < minInterval && fs.existsSync(screenPath)) {
    return screenPath;
  }
  screenBusy = (async () => {
    await native.call('screenshot', {
      path: screenPath,
      quality: config.screen?.quality || 55,
      maxWidth: config.screen?.maxWidth || 1280
    }, 15_000);
    lastScreenAt = Date.now();
    return screenPath;
  })();
  try {
    return await screenBusy;
  } catch (err) {
    throw err;
  } finally {
    screenBusy = null;
  }
}

// ---------------------------------------------------------------- HTTP routes
// Asset URLs carry a build stamp so a phone that already loaded the old page
// cannot keep serving a stale app.js/app.css from its HTTP cache after an
// update. The stamp only changes when the web files change.
let cachedBuildId = null;
function buildId() {
  if (cachedBuildId) return cachedBuildId;
  let hash = 5381;
  for (const name of ['index.html', 'app.js', 'app.css', 'sw.js', 'manifest.webmanifest']) {
    try {
      const stat = fs.statSync(path.join(WEB_DIR, name));
      const seed = `${name}:${stat.size}:${Math.floor(stat.mtimeMs)}`;
      for (let i = 0; i < seed.length; i += 1) hash = ((hash * 33) ^ seed.charCodeAt(i)) >>> 0;
    } catch {
      /* missing file: ignore */
    }
  }
  cachedBuildId = hash.toString(36);
  return cachedBuildId;
}

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : decodeURIComponent(pathname.replace(/^\/+/, ''));
  const full = path.resolve(WEB_DIR, relative);
  if (!full.startsWith(WEB_DIR + path.sep) && full !== path.join(WEB_DIR, 'index.html')) {
    return sendError(res, 403, 'Forbidden');
  }
  fs.stat(full, (err, stat) => {
    if (err || !stat.isFile()) return sendError(res, 404, 'Not found');
    const isHtml = full.endsWith('index.html');
    const headers = {
      'Content-Type': mimeFor(full),
      'Content-Length': stat.size,
      // The UI changes whenever the PC app is updated, so never let the phone
      // keep an old copy of the HTML/JS/CSS for an hour.
      'Cache-Control': /\.(?:png|jpe?g|svg|ico|webmanifest|woff2?)$/i.test(full)
        ? 'public, max-age=86400'
        : 'no-cache'
    };
    if (isHtml) {
      let html = fs.readFileSync(full, 'utf8');
      if (html.includes('__BUILD__')) html = html.split('__BUILD__').join(buildId());
      headers['Content-Type'] = 'text/html; charset=utf-8';
      headers['Content-Length'] = Buffer.byteLength(html);
      res.writeHead(200, headers);
      if (req.method === 'HEAD') return res.end();
      res.end(html);
      return;
    }
    res.writeHead(200, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(full).pipe(res);
  });
}

function adminStatus() {
  return {
    name: serverName,
    id: serverId,
    version: VERSION,
    protocol: PROTOCOL,
    apiVersion: API_VERSION,
    port: serverPort,
    discoveryPort,
    host: os.hostname(),
    os: 'windows',
    standalone,
    running: true,
    startedAt: new Date(startedAt).toISOString(),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    pin: getPin(),
    pinRequired: pinRequired(config),
    urls: phoneUrls(),
    ips: localIpList(),
    clients: listClients(),
    connected: clientCount(),
    nativeReady: Boolean(native.ready),
    nativeError: native.lastError || null,
    dataDir: DATA_DIR,
    logFile: getLogFile(),
    configFile: CONFIG_FILE
  };
}

function adminHtml(req) {
  const ips = localIpList();
  const urls = ips.map((ip) => `http://${ip}:${serverPort}`);
  const clients = listClients();
  const rows = clients.length
    ? clients.map((c) => `<tr><td>${escapeHtml(c.name)}</td><td>${escapeHtml(c.platform)}</td><td>${escapeHtml(c.ip)}</td><td>${escapeHtml(c.lastSeen || '')}</td><td><button data-revoke="${escapeHtml(c.id)}">Revoke</button></td></tr>`).join('')
    : '<tr><td colspan="5" class="muted">No paired devices yet.</td></tr>';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(serverName)} — Admin</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;padding:32px;background:#0b1020;color:#e8ecf8;font:15px/1.5 "Segoe UI",system-ui,sans-serif}
main{max-width:860px;margin:0 auto}
h1{font-size:24px;margin:0 0 4px}
h2{font-size:15px;text-transform:uppercase;letter-spacing:.08em;color:#8ea0c9;margin:28px 0 10px}
.card{background:#141a2e;border:1px solid #253053;border-radius:14px;padding:20px;margin-bottom:16px}
.pin{font-size:42px;font-weight:700;letter-spacing:.18em;color:#7ee0a8;font-variant-numeric:tabular-nums}
a{color:#7fb2ff}
code{background:#0b1020;padding:2px 6px;border-radius:6px}
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #253053}
button{background:#2b4bff;border:0;color:#fff;padding:8px 14px;border-radius:8px;cursor:pointer;font:inherit}
button.ghost{background:#253053}
button.danger{background:#b02a37}
.muted{color:#8ea0c9}
.row{display:flex;gap:12px;flex-wrap:wrap;align-items:center}
.badge{display:inline-flex;align-items:center;gap:7px;background:#0b1020;border:1px solid #253053;border-radius:999px;padding:5px 11px;font-size:12px;color:#b8c6e8}
.dot{width:8px;height:8px;border-radius:50%;background:#34d399;box-shadow:0 0 10px #34d399}
.tray{background:linear-gradient(135deg,rgba(91,140,255,.18),rgba(168,85,247,.12))}
</style></head>
<body><main>
<h1>${escapeHtml(serverName)}</h1>
<div class="muted">Admin panel · ${escapeHtml(serverId)} · v${VERSION} · protocol ${PROTOCOL}</div>

<div class="card tray">
  <div class="badge"><span class="dot"></span> Server running in the notification area</div>
  <p class="muted" style="margin-bottom:0">Right-click the tray icon for PIN controls, firewall access, start-with-Windows, restart and stop. Closing this browser tab does not stop the server.</p>
</div>

<h2>Pairing PIN</h2>
<div class="card">
  <div class="pin" id="pin">${escapeHtml(getPin())}</div>
  <p class="muted">Enter this PIN in the AM PC Remote Android app. Rotating it signs out every paired device.</p>
  <div class="row">
    <button id="rotate">Rotate PIN</button>
    <button id="toggle" class="ghost">${pinRequired(config) ? 'Disable PIN' : 'Enable PIN'}</button>
  </div>
</div>

<h2>Open on your phone</h2>
<div class="card">
  ${urls.length ? urls.map((u) => `<div><a href="${escapeHtml(u)}">${escapeHtml(u)}</a></div>`).join('') : '<div class="muted">No LAN address detected. Connect to Wi-Fi / Ethernet.</div>'}
  <p class="muted">Same Wi-Fi network required. Discovery: UDP ${discoveryPort}. The Android app finds running servers automatically; you can also type an address manually.</p>
</div>

<h2>Paired devices (${clients.length})</h2>
<div class="card">
<table><thead><tr><th>Name</th><th>Platform</th><th>IP</th><th>Last seen</th><th></th></tr></thead>
<tbody>${rows}</tbody></table>
</div>

<h2>Server</h2>
<div class="card muted">
  Node ${process.version} · uptime ${Math.round(process.uptime())}s · native input ${native.ready ? 'ready' : 'offline'} · connected clients ${clientCount()}<br>
  Config: <code>${escapeHtml(CONFIG_FILE)}</code><br>
  Data: <code>${escapeHtml(DATA_DIR)}</code> · Log: <code>${escapeHtml(getLogFile())}</code>
  <p style="margin-bottom:0">If your phone cannot connect, allow TCP ${serverPort} and UDP ${discoveryPort} for Private networks, or use the tray icon's <strong>Allow firewall access</strong> item.</p>
</div>

<script>
async function post(url, body){
  const r = await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})});
  if(!r.ok){ alert((await r.json().catch(()=>({}))).error || 'Request failed'); return; }
  location.reload();
}
document.getElementById('rotate').onclick=()=>{ if(confirm('Rotate the PIN and sign out all paired devices?')) post('/api/admin/pin'); };
document.getElementById('toggle').onclick=()=>post('/api/admin/require-pin',{value:${pinRequired(config) ? 'false' : 'true'}});
document.querySelectorAll('[data-revoke]').forEach(b=>b.onclick=()=>post('/api/admin/revoke',{id:b.dataset.revoke}));
</script>
</main></body></html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;
  const method = req.method || 'GET';

  try {
    if (method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        name: serverName,
        id: serverId,
        version: VERSION,
        protocol: PROTOCOL,
        apiVersion: API_VERSION,
        port: serverPort,
        discoveryPort,
        pinRequired: pinRequired(config),
        running: true
      });
    }

    if (method === 'GET' && pathname === '/api/hello') {
      return sendJson(res, 200, {
        name: serverName,
        id: serverId,
        version: VERSION,
        protocol: PROTOCOL,
        apiVersion: API_VERSION,
        pinRequired: pinRequired(config),
        nonce: newNonce(),
        locked: authLocked(hostIp(req)),
        platform: 'windows',
        os: 'windows',
        host: os.hostname(),
        port: serverPort,
        discoveryPort,
        urls: phoneUrls(),
        features: ['remotes', 'sse', 'screen', 'power', 'clipboard', 'discovery', 'tasker', 'app-pairing']
      });
    }

    if (method === 'POST' && pathname === '/api/auth') {
      const body = await readBody(req, 100_000);
      const ip = hostIp(req);
      if (pinRequired(config)) {
        const result = verifyPin({ nonce: body.nonce, proof: body.proof, ip });
        if (!result.ok) return sendError(res, 401, result.error);
      }
      const issued = issueToken({
        name: body.clientName,
        platform: body.platform,
        ip
      });
      log(`Paired device: ${issued.client.name} (${issued.client.platform}, ${ip})`);
      broadcast({ type: 'clients', count: clientCount() });
      return sendJson(res, 200, {
        token: issued.token,
        client: { id: issued.client.id, name: issued.client.name },
        server: { name: serverName, id: serverId, version: VERSION, port: serverPort, protocol: PROTOCOL }
      });
    }

    const client = authenticate(req, url);

    if (method === 'GET' && pathname === '/admin') {
      if (!isLoopback(hostIp(req))) return sendError(res, 403, 'Admin is available on the PC itself only');
      const html = adminHtml(req);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(html);
    }

    if (pathname.startsWith('/api/admin/')) {
      if (!isLoopback(hostIp(req))) return sendError(res, 403, 'Admin is available on the PC itself only');
      if (method === 'GET' && (pathname === '/api/admin/status' || pathname === '/api/admin/summary')) {
        return sendJson(res, 200, adminStatus());
      }
      if (method === 'GET' && pathname === '/api/admin/pin') {
        return sendJson(res, 200, { pin: getPin(), pinRequired: pinRequired(config) });
      }
      if (method !== 'POST') return sendError(res, 405, 'Method not allowed');
      const body = await readBody(req, 100_000);
      if (pathname === '/api/admin/pin' || pathname === '/api/admin/rotate-pin') {
        const pin = rotatePin();
        log('PIN rotated; paired devices signed out');
        broadcast({ type: 'clients', count: clientCount() });
        return sendJson(res, 200, { pin, revoked: true });
      }
      if (pathname === '/api/admin/require-pin') {
        const value = setRequirePin(body.value);
        log(`PIN requirement ${value ? 'enabled' : 'disabled'}`);
        return sendJson(res, 200, { requirePin: value });
      }
      if (pathname === '/api/admin/revoke') {
        return sendJson(res, 200, { revoked: revokeClient(body.id) });
      }
      if (pathname === '/api/admin/stop') {
        sendJson(res, 200, { ok: true, stopping: true });
        log('Stop requested from the PC admin/tray');
        setTimeout(() => shutdown(), 180);
        return;
      }
      return sendError(res, 404, 'Not found');
    }

    if (method === 'GET' && pathname === '/api/events') {
      if (!client) return sendError(res, 401, 'Unauthorized');
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      res.write(`: connected ${timestamp()}\n\n`);
      const entry = { res, client };
      sseClients.add(entry);
      broadcast({ type: 'clients', count: sseClients.size });
      res.write(`data: ${JSON.stringify({ type: 'hello', name: serverName, version: VERSION, client: client.name })}\n\n`);
      if (lastStatus) res.write(`data: ${JSON.stringify({ type: 'status', status: lastStatus })}\n\n`);
      req.on('close', () => {
        sseClients.delete(entry);
      });
      return;
    }

    if (method === 'GET' && pathname === '/api/remotes') {
      if (!client) return sendError(res, 401, 'Unauthorized');
      return sendJson(res, 200, { remotes: remoteSummaries(), server: serverName, version: VERSION, protocol: PROTOCOL });
    }

    if (method === 'GET' && pathname.startsWith('/api/remotes/')) {
      if (!client) return sendError(res, 401, 'Unauthorized');
      const id = decodeURIComponent(pathname.slice('/api/remotes/'.length));
      const remote = getRemote(id);
      if (!remote) return sendError(res, 404, 'Unknown remote');
      const { file, ...safe } = remote;
      return sendJson(res, 200, safe);
    }

    if (method === 'GET' && pathname === '/api/state') {
      if (!client) return sendError(res, 401, 'Unauthorized');
      const status = await readStatus();
      return sendJson(res, 200, {
        status,
        clients: clientCount(),
        server: { name: serverName, id: serverId, version: VERSION, port: serverPort, protocol: PROTOCOL },
        volume: status.volume,
        muted: status.muted
      });
    }

    if (method === 'POST' && pathname === '/api/action') {
      if (!client) return sendError(res, 401, 'Unauthorized');
      const body = await readBody(req, 200_000);
      const remote = getRemote(String(body.remote || ''));
      if (!remote) return sendError(res, 404, 'Unknown remote');
      const actionName = String(body.action || '');
      try {
        const result = await executeAction(
          { native, config, client },
          remote,
          actionName,
          body.args || {}
        );
        broadcast({
          type: 'action',
          remote: remote.id,
          action: actionName,
          by: client.name
        });
        if (remote.id === 'am.media' || remote.id === 'am.system' || actionName.includes('volume')) {
          pushStatus();
        }
        return sendJson(res, 200, { ok: true, result: result ?? null });
      } catch (err) {
        return sendError(res, 400, err.message);
      }
    }

    if (method === 'GET' && pathname === '/api/screen.jpg') {
      if (!client) return sendError(res, 401, 'Unauthorized');
      const file = await captureScreen();
      const stat = fs.statSync(file);
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Content-Length': stat.size,
        'Cache-Control': 'no-store'
      });
      return fs.createReadStream(file).pipe(res);
    }

    if (method === 'GET' && pathname === '/api/clients') {
      if (!client) return sendError(res, 401, 'Unauthorized');
      return sendJson(res, 200, { clients: listClients(), connected: clientCount() });
    }

    if (method === 'POST' && pathname === '/api/logout') {
      if (!client) return sendError(res, 401, 'Unauthorized');
      revokeClient(client.id);
      return sendJson(res, 200, { ok: true });
    }

    if (method === 'GET' || method === 'HEAD') {
      if (pathname.startsWith('/api/')) return sendError(res, 404, 'Not found');
      return serveStatic(req, res, pathname);
    }

    return sendError(res, 405, 'Method not allowed');
  } catch (err) {
    logError('Request error:', err.message);
    if (!res.headersSent) sendError(res, 500, err.message);
    else res.end();
  }
});

// ---------------------------------------------------------------- discovery
let discoverySocket = null;
let lastProbeLog = 0;

function announcePayload() {
  return {
    am: 'announce',
    app: 'am-pc-remote',
    id: serverId,
    name: serverName,
    host: os.hostname(),
    port: serverPort,
    discoveryPort,
    version: VERSION,
    protocol: PROTOCOL,
    apiVersion: API_VERSION,
    os: 'windows',
    pinRequired: pinRequired(config),
    clients: listClients().length,
    url: phoneUrls()[0] || null
  };
}

function isDiscoveryProbe(text, parsed) {
  if (parsed && (parsed.am === 'discover' || parsed.am === 'ampc-discover' || parsed.discover === true)) return true;
  if (parsed && parsed.app === 'com.adiraimaji.ampcremote') return true;
  const upper = text.toUpperCase();
  return upper.startsWith('AM-PC-REMOTE') || upper.startsWith('AMPCREMOTE_DISCOVER') || upper.startsWith('AMPC_DISCOVER');
}

function broadcastAddresses() {
  const out = new Set(['255.255.255.255']);
  try {
    for (const nets of Object.values(os.networkInterfaces())) {
      for (const net of nets || []) {
        if (net.family !== 'IPv4' || net.internal) continue;
        const parts = net.address.split('.').map(Number);
        const mask = (net.netmask || '255.255.255.0').split('.').map(Number);
        if (parts.length !== 4 || mask.length !== 4) continue;
        out.add(parts.map((p, i) => (p & mask[i]) | (~mask[i] & 255)).join('.'));
      }
    }
  } catch {
    /* best effort */
  }
  return [...out];
}

function startDiscovery() {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  socket.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8');
    let request = null;
    try {
      request = JSON.parse(text);
    } catch {
      request = null;
    }
    if (!isDiscoveryProbe(text, request)) return;

    const now = Date.now();
    if (now - lastProbeLog > 60_000) {
      lastProbeLog = now;
      log(`Discovery probe from ${rinfo.address}:${rinfo.port}`);
    }
    const reply = Buffer.from(JSON.stringify(announcePayload()));
    socket.send(reply, rinfo.port, rinfo.address, () => {});
  });
  socket.on('error', (err) => log('Discovery socket error:', err.message));
  socket.bind(discoveryPort, () => {
    try {
      socket.setBroadcast(true);
    } catch {
      /* best effort */
    }
    log(`Discovery listening on UDP ${discoveryPort}`);
  });
  discoverySocket = socket;

  if (config.broadcast !== false) {
    const announce = () => {
      const payload = Buffer.from(JSON.stringify(announcePayload()));
      for (const address of broadcastAddresses()) {
        try {
          socket.send(payload, 0, payload.length, discoveryPort, address);
        } catch {
          /* broadcast is best-effort */
        }
      }
    };
    announce();
    setInterval(announce, Math.max(3000, Number(config.broadcastIntervalMs) || 15000)).unref();
  }
}

// ---------------------------------------------------------------- tray
let trayProcess = null;

function startTray() {
  if (process.platform !== 'win32') return;
  if (config.tray === false) return;
  if (cli.includes('--no-tray')) return;
  if (!fs.existsSync(TRAY_SCRIPT)) {
    log('Tray script is missing:', TRAY_SCRIPT);
    return;
  }
  try {
    trayProcess = spawn('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Sta',
      '-ExecutionPolicy', 'Bypass',
      '-WindowStyle', 'Hidden',
      '-File', TRAY_SCRIPT,
      '-Port', String(serverPort),
      '-DiscoveryPort', String(discoveryPort),
      '-ParentPid', String(process.pid),
      '-Version', VERSION,
      '-ExePath', process.execPath,
      '-AppRoot', ROOT,
      '-Standalone', standalone ? '1' : '0'
    ], {
      windowsHide: true,
      stdio: 'ignore',
      detached: false
    });
    trayProcess.on('error', (err) => log('Tray process error:', err.message));
    trayProcess.on('exit', (code) => {
      trayProcess = null;
      if (code !== 0) log(`Tray process exited (${code})`);
    });
    log('Notification-area icon started');
  } catch (err) {
    log('Could not start tray icon:', err.message);
  }
}

// ---------------------------------------------------------------- start
server.listen(serverPort, '0.0.0.0', () => {
  startDiscovery();
  const urls = phoneUrls();
  log(`${serverName} v${VERSION} is running`);
  log(`PC admin : http://localhost:${serverPort}/admin`);
  for (const url of urls) log(`Phone    : ${url}`);
  log(`PIN      : ${getPin()}`);
  log(`Discovery: UDP ${discoveryPort}`);
  log(`Data     : ${DATA_DIR}`);
  startTray();

  if (standalone && config.openAdminOnStart !== false && !cli.includes('--no-open')) {
    setTimeout(() => openBrowser(`http://localhost:${serverPort}/admin`), 900);
  }
});

server.on('error', async (err) => {
  if (err.code === 'EADDRINUSE') {
    log(`Port ${serverPort} is already in use.`);
    try {
      const response = await fetch(`http://127.0.0.1:${serverPort}/health`, { signal: AbortSignal.timeout(1500) });
      const info = await response.json();
      if (info?.ok && info?.name) {
        log(`An AM PC Remote server is already running (${info.name} v${info.version}); opening admin page.`);
        if (!cli.includes('--no-open')) openBrowser(`http://localhost:${serverPort}/admin`);
        process.exit(0);
      }
    } catch {
      /* port belongs to another program */
    }
    showMessageBox('AM PC Remote',
      `TCP port ${serverPort} is already used by another program.\n\n` +
      `Stop that program or change "port" in:\n${CONFIG_FILE}\n\n` +
      `Log: ${getLogFile()}`);
    process.exit(1);
  }
  logError('Server error:', err.message);
  showMessageBox('AM PC Remote', `The server could not start:\n${err.message}\n\nLog: ${getLogFile()}`);
  process.exit(1);
});

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  log('Shutting down...');
  try {
    discoverySocket?.close();
  } catch {
    /* ignore */
  }
  native.stop();
  try {
    server.close();
  } catch {
    /* ignore */
  }
  // Give an in-flight tray/admin request a moment to flush, then exit.
  setTimeout(() => process.exit(0), 600).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('uncaughtException', (err) => {
  logError('Uncaught exception:', err);
  showMessageBox('AM PC Remote', `AM PC Remote encountered an error and will stop.\n\n${err.message}\n\nLog: ${getLogFile()}`);
  shutdown();
});
process.on('unhandledRejection', (err) => {
  logError('Unhandled rejection:', err);
});
