/**
 * Static validation for the shipped remote definitions.
 * Catches typos in action names and unsupported widget types without
 * touching the desktop.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const remotesDir = path.resolve(here, '..', 'remotes');

const BUILTINS = new Set([
  '__keys', '__pointer', '__text', '__volume', '__power', '__open', '__window',
  '__clipboard', '__procs', '__status', '__media', '__sequence', '__noop'
]);
const WIDGETS = new Set([
  'grid', 'row', 'button', 'slider', 'input', 'liveInput', 'specialKeys', 'keysToggle',
  'keyboardToggle', 'trackpad', 'screen', 'status', 'stat', 'procs', 'spacer', 'text'
]);
const LOCALS = new Set(['copy', 'refresh', 'drag']);

const files = fs.readdirSync(remotesDir).filter((f) => f.endsWith('.json')).sort();
assert.ok(files.length >= 10, 'expected at least 10 remotes');

const ids = new Set();
let widgetCount = 0;
let buttonCount = 0;

function walk(node, file, trail) {
  assert.ok(node && typeof node === 'object', `${file}: ${trail} is not an object`);
  assert.ok(WIDGETS.has(node.type), `${file}: ${trail} has unknown widget type "${node.type}"`);
  widgetCount += 1;

  if (node.type === 'button') {
    buttonCount += 1;
    assert.ok(typeof node.text === 'string' && node.text.length > 0, `${file}: ${trail} button needs text`);
    const known = new Set([...BUILTINS, ...Object.keys(currentActions)]);
    if (node.local) {
      assert.ok(LOCALS.has(node.local), `${file}: ${trail} has unknown local action "${node.local}"`);
      assert.ok(!node.action, `${file}: ${trail} cannot have both action and local`);
    } else {
      assert.ok(node.action, `${file}: ${trail} button has no action`);
      assert.ok(known.has(node.action), `${file}: ${trail} references unknown action "${node.action}"`);
    }
    if (node.args !== undefined) assert.equal(typeof node.args, 'object', `${file}: ${trail} args must be an object`);
  }

  for (const child of node.children || []) walk(child, file, `${trail}/${child.type}`);
  for (const tool of node.tools || []) walk(tool, file, `${trail}/tool`);
  for (const row of node.rows || []) {
    assert.ok(row && Array.isArray(row.children), `${file}: ${trail} row needs children`);
    for (const child of row.children) walk(child, file, `${trail}/row`);
  }
}

let currentActions = {};

for (const file of files) {
  const remote = JSON.parse(fs.readFileSync(path.join(remotesDir, file), 'utf8'));
  currentActions = remote.actions || {};

  assert.ok(remote.id && /^am\.[a-z0-9]+$/.test(remote.id), `${file}: id must look like am.<name>`);
  assert.ok(!ids.has(remote.id), `${file}: duplicate id ${remote.id}`);
  ids.add(remote.id);
  assert.ok(remote.name, `${file}: missing name`);
  assert.ok(remote.layout, `${file}: missing layout`);
  assert.equal(remote.layout.type, 'grid', `${file}: root layout must be a grid`);
  assert.ok(Array.isArray(remote.layout.rows) && remote.layout.rows.length > 0, `${file}: layout has no rows`);

  walk(remote.layout, file, remote.id);
}

console.log(`ok - ${files.length} remotes, ${widgetCount} widgets, ${buttonCount} buttons`);
console.log(ids.size === files.length ? 'ok - remote ids are unique' : 'not ok - duplicate ids');
