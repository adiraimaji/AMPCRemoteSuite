import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson, writeJson } from '../src/util.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-pc-remote-test-'));
try {
  const plain = path.join(dir, 'plain.json');
  writeJson(plain, { pin: '123456', requirePin: true });
  assert.deepEqual(readJson(plain, null), { pin: '123456', requirePin: true });

  const bom = path.join(dir, 'bom.json');
  fs.writeFileSync(bom, '\uFEFF{"pin":"654321"}', 'utf8');
  assert.deepEqual(readJson(bom, null), { pin: '654321' });

  assert.deepEqual(readJson(path.join(dir, 'missing.json'), { fallback: true }), { fallback: true });
  console.log('ok - JSON settings survive UTF-8 BOM and round-trip cleanly');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
