// End-to-end smoke test. Start the server first, then run:
//   node test/server-smoke.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const base = process.env.AM_BASE || 'http://127.0.0.1:9600';
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${base}/health`);
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

const up = await waitForServer();
check('server is listening', up, base);
if (!up) process.exit(1);

const hello = await fetch(`${base}/api/hello`).then((r) => r.json());
check('hello returns server identity', Boolean(hello.name && hello.id && hello.nonce), hello.name);

const settings = JSON.parse(fs.readFileSync(path.join(root, 'data', 'settings.json'), 'utf8').replace(/^\uFEFF/, ''));
const proof = crypto.createHash('sha256').update(`${hello.nonce}:${settings.pin}`).digest('hex');
const authRes = await fetch(`${base}/api/auth`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ nonce: hello.nonce, proof, clientName: 'Smoke test', platform: 'node' })
});
const auth = await authRes.json();
check('pairing with PIN succeeds', authRes.ok && Boolean(auth.token), auth.error || 'token issued');
if (!auth.token) process.exit(1);

const token = auth.token;
const headers = { Authorization: `Bearer ${token}` };

const remotes = await fetch(`${base}/api/remotes`, { headers }).then((r) => r.json());
check('remote list is served', Array.isArray(remotes.remotes) && remotes.remotes.length >= 8, `${remotes.remotes?.length} remotes`);

const layout = await fetch(`${base}/api/remotes/am.trackpad`, { headers }).then((r) => r.json());
check('remote layout is served', layout.layout?.type === 'grid', layout.name);

async function action(remote, name, args = {}) {
  const res = await fetch(`${base}/api/action`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ remote, action: name, args })
  });
  return { ok: res.ok, body: await res.json() };
}

let state = null;
for (let i = 0; i < 60; i += 1) {
  state = await fetch(`${base}/api/state`, { headers }).then((r) => r.json());
  if (state.status?.native) break;
  await new Promise((r) => setTimeout(r, 500));
}
check('native input host is available', Boolean(state.status?.native), state.status?.error || 'ready');
check('status includes system metrics', typeof state.status?.mem === 'number' && typeof state.status?.cpu === 'number',
  `cpu=${state.status?.cpu} mem=${state.status?.mem} battery=${state.status?.battery}`);

const procs = await action('am.system', '__procs', { count: 3 });
check('process list action works', procs.ok && Array.isArray(procs.body.result) && procs.body.result.length > 0,
  `${procs.body.result?.length || 0} rows`);

const volume = await action('am.media', '__volume', { op: 'get' });
check('volume read works', volume.ok && typeof volume.body.result?.volume === 'number', JSON.stringify(volume.body.result));

const status = await action('am.system', '__status');
check('status action works', status.ok && Boolean(status.body.result?.time), status.body.result?.time);

const screenRes = await fetch(`${base}/api/screen.jpg?token=${encodeURIComponent(token)}`);
const screenBuf = Buffer.from(await screenRes.arrayBuffer());
check('screenshot endpoint returns JPEG', screenRes.ok && screenBuf[0] === 0xff && screenBuf[1] === 0xd8,
  `${Math.round(screenBuf.length / 1024)} KB`);

const index = await fetch(`${base}/`).then((r) => r.text());
check('phone web app is served', index.includes('AM PC Remote') && index.includes('/app.js'));

const admin = await fetch(`${base}/admin`).then((r) => r.text());
check('localhost admin shows the PIN', admin.includes(settings.pin) && admin.includes('Rotate PIN'));

const bad = await fetch(`${base}/api/remotes`);
check('API rejects missing token', bad.status === 401, `HTTP ${bad.status}`);

await fetch(`${base}/api/logout`, { method: 'POST', headers });
check('logout revokes the token', (await fetch(`${base}/api/state`, { headers })).status === 401);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
