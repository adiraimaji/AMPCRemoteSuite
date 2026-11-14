// Development smoke test for the native input bridge.
// Run: node test/native-smoke.mjs
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NativeHost } from '../src/native.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const script = path.join(root, 'native', 'InputHost.ps1');
const outDir = path.join(root, 'data', 'tmp');
fs.mkdirSync(outDir, { recursive: true });

const host = new NativeHost(script);
const started = Date.now();
await host.start();
console.log(`ready in ${Date.now() - started} ms`);

console.log('ping     :', await host.call('ping'));
const status = await host.call('status');
console.log('status   :', {
  cpu: status.cpu,
  mem: status.mem,
  battery: status.battery,
  volume: status.volume,
  muted: status.muted,
  window: status.window,
  process: status.process,
  uptimeSec: status.uptimeSec
});
console.log('volume   :', await host.call('volume', { op: 'get' }));
console.log('procs    :', await host.call('procs', { count: 3 }));
const shot = path.join(outDir, 'native-smoke.jpg');
await host.call('screenshot', { path: shot, quality: 40, maxWidth: 800 }, 20_000);
const size = fs.statSync(shot).size;
console.log('screenshot:', shot, `${Math.round(size / 1024)} KB`);
host.stop();
