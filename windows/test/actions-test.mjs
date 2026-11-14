/**
 * Unit tests for built-in action dispatch.
 *
 * Uses a mock native host, so no keystrokes, clicks, clipboard changes,
 * or power commands ever reach the real desktop.
 */
import assert from 'node:assert/strict';
import { executeAction, parseCombo, vkFor } from '../src/actions.js';

class MockNative {
  constructor() {
    this.calls = [];
  }

  async call(cmd, args = {}) {
    this.calls.push({ cmd, args });
    if (cmd === 'clipboard' && args.op === 'get') return { text: 'from-pc' };
    if (cmd === 'status') return { ok: true, cpu: 1 };
    if (cmd === 'procs') return [{ name: 'x', cpu: 1 }];
    if (cmd === 'volume' && args.op === 'get') return { volume: 42, muted: false };
    return true;
  }

  last() {
    return this.calls.at(-1);
  }
}

const config = {
  apps: [{ id: 'calc', target: 'C:\\Windows\\System32\\calc.exe' }],
  allowedPaths: [],
  allowPower: true
};

const remote = {
  actions: {
    customText: { type: 'text', text: 'hello from definition' },
    customMacro: { type: 'sequence', steps: [{ type: 'keys', keys: ['alt+f4'] }, { type: 'wait', ms: 1 }] }
  }
};

let native;
let ctx;

function reset() {
  native = new MockNative();
  ctx = { native, config };
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test('vkFor resolves letters, digits, function keys and symbols', () => {
  assert.equal(vkFor('a'), 0x41);
  assert.equal(vkFor('7'), 0x37);
  assert.equal(vkFor('f5'), 0x74);
  assert.equal(vkFor('enter'), 0x0d);
  assert.equal(vkFor('plus'), 0xbb);
  assert.equal(vkFor('equals'), 0xbb);
  assert.throws(() => vkFor('definitely-not-a-key'), /Unknown key/);
});

test('parseCombo splits modifiers in any order', () => {
  assert.deepEqual(parseCombo('ctrl+shift+t'), { vk: 0x54, mods: [0x11, 0x10] });
  assert.deepEqual(parseCombo('alt+left'), { vk: 0x25, mods: [0x12] });
  assert.throws(() => parseCombo('hyper+x'), /Unknown modifier/);
});

test('__keys forwards args.keys', async () => {
  reset();
  await executeAction(ctx, remote, '__keys', { keys: ['ctrl+t'] });
  assert.deepEqual(native.last(), { cmd: 'key', args: { vk: 0x54, mods: [0x11] } });
});

test('__keydown holds the key and its modifiers', async () => {
  reset();
  await executeAction(ctx, remote, '__keydown', { keys: ['ctrl+shift'] });
  assert.deepEqual(native.calls.map((c) => c.cmd), ['keydown', 'keydown']);
  assert.deepEqual(native.calls.map((c) => c.args.vk), [0x11, 0x10]);
});

test('__keyup releases the key before its modifiers', async () => {
  reset();
  await executeAction(ctx, remote, '__keyup', { keys: ['ctrl+shift'] });
  assert.deepEqual(native.calls.map((c) => c.cmd), ['keyup', 'keyup']);
  assert.deepEqual(native.calls.map((c) => c.args.vk), [0x10, 0x11]);
});

test('__keydown and __keyup hold and release a plain key', async () => {
  reset();
  await executeAction(ctx, remote, '__keydown', { keys: ['alt'] });
  assert.deepEqual(native.last(), { cmd: 'keydown', args: { vk: 0x12 } });
  reset();
  await executeAction(ctx, remote, '__keyup', { keys: ['alt'] });
  assert.deepEqual(native.last(), { cmd: 'keyup', args: { vk: 0x12 } });
});

test('__keys accepts a single string key', async () => {
  reset();
  await executeAction(ctx, remote, '__keys', { keys: 'alt+left' });
  assert.deepEqual(native.last(), { cmd: 'key', args: { vk: 0x25, mods: [0x12] } });
});

test('__keys cannot be retyped into another action', async () => {
  reset();
  await executeAction(ctx, remote, '__keys', { type: 'open', target: 'calc', keys: ['f5'] });
  assert.equal(native.calls.length, 1);
  assert.equal(native.last().cmd, 'key');
  assert.equal(native.last().args.vk, 0x74);
});

test('__keys with no keys is a no-op', async () => {
  reset();
  await executeAction(ctx, remote, '__keys', {});
  assert.equal(native.calls.length, 0);
});

test('__media forwards args.key', async () => {
  reset();
  await executeAction(ctx, remote, '__media', { key: 'next' });
  assert.deepEqual(native.last(), { cmd: 'key', args: { vk: 0xb0 } });
});

test('__media defaults to play/pause', async () => {
  reset();
  await executeAction(ctx, remote, '__media', {});
  assert.deepEqual(native.last(), { cmd: 'key', args: { vk: 0xb3 } });
});

test('__power forwards args.mode', async () => {
  reset();
  await executeAction(ctx, remote, '__power', { mode: 'monitoroff' });
  assert.deepEqual(native.last(), { cmd: 'power', args: { mode: 'monitoroff' } });
});

test('__power requires confirmation for restart/shutdown', async () => {
  reset();
  await assert.rejects(executeAction(ctx, remote, '__power', { mode: 'restart' }), /confirmation/);
  assert.equal(native.calls.length, 0);
  await executeAction(ctx, remote, '__power', { mode: 'restart', confirm: true });
  assert.deepEqual(native.last(), { cmd: 'power', args: { mode: 'restart' } });
});

test('__power rejects unknown modes', async () => {
  reset();
  await assert.rejects(executeAction(ctx, remote, '__power', { mode: 'explode' }), /Unknown power mode/);
});

test('__window maps modes to key combos', async () => {
  reset();
  await executeAction(ctx, remote, '__window', { mode: 'desktop' });
  assert.deepEqual(native.last(), { cmd: 'key', args: { vk: 0x44, mods: [0x5b] } });
  reset();
  await executeAction(ctx, remote, '__window', { mode: 'switch' });
  assert.deepEqual(native.last(), { cmd: 'key', args: { vk: 0x09, mods: [0x12] } });
});

test('__window lock maps to the power helper, not a random lock fallback', async () => {
  reset();
  await executeAction(ctx, remote, '__window', { mode: 'lock' });
  assert.deepEqual(native.last(), { cmd: 'power', args: { mode: 'lock' } });
  reset();
  await assert.rejects(executeAction(ctx, remote, '__window', { mode: 'nonsense' }), /Unknown window mode/);
  assert.equal(native.calls.length, 0);
});

test('__clipboard forwards set and get', async () => {
  reset();
  await executeAction(ctx, remote, '__clipboard', { op: 'set', text: 'copied' });
  assert.deepEqual(native.last(), { cmd: 'clipboard', args: { op: 'set', text: 'copied' } });
  reset();
  const result = await executeAction(ctx, remote, '__clipboard', { op: 'get' });
  assert.deepEqual(result, { text: 'from-pc' });
});

test('__clipboard rejects unknown ops', async () => {
  reset();
  await assert.rejects(executeAction(ctx, remote, '__clipboard', { op: 'wipe' }), /Unknown clipboard op/);
});

test('__procs forwards args.count and clamps it', async () => {
  reset();
  await executeAction(ctx, remote, '__procs', { count: 3 });
  assert.deepEqual(native.last(), { cmd: 'procs', args: { count: 3 } });
  reset();
  await executeAction(ctx, remote, '__procs', { count: 999 });
  assert.deepEqual(native.last(), { cmd: 'procs', args: { count: 20 } });
});

test('__volume forwards set/get and validates op', async () => {
  reset();
  await executeAction(ctx, remote, '__volume', { op: 'set', value: 55 });
  assert.deepEqual(native.last(), { cmd: 'volume', args: { op: 'set', value: 55 } });
  reset();
  assert.deepEqual(await executeAction(ctx, remote, '__volume', { op: 'get' }), { volume: 42, muted: false });
  reset();
  await assert.rejects(executeAction(ctx, remote, '__volume', { op: 'max' }), /Unknown volume op/);
});

test('__pointer forwards movement and clicks', async () => {
  reset();
  await executeAction(ctx, remote, '__pointer', { op: 'move', dx: 12, dy: -4 });
  assert.deepEqual(native.calls[0], { cmd: 'move', args: { dx: 12, dy: -4 } });
  reset();
  await executeAction(ctx, remote, '__pointer', { op: 'click' });
  assert.deepEqual(native.calls.map((c) => c.args.down), [true, false]);
});

test('__open only allows configured apps and allow-listed paths', async () => {
  reset();
  await executeAction(ctx, remote, '__open', { target: 'calc' });
  assert.deepEqual(native.last(), { cmd: 'open', args: { target: 'C:\\Windows\\System32\\calc.exe' } });
  reset();
  await assert.rejects(executeAction(ctx, remote, '__open', { target: 'C:\\Windows\\System32\\cmd.exe' }), /allow-list/);
  assert.equal(native.calls.length, 0);
});

test('remote-defined actions still work', async () => {
  reset();
  await executeAction(ctx, remote, 'customText', { text: 'override' });
  assert.deepEqual(native.last(), { cmd: 'type', args: { text: 'override' } });
  reset();
  await executeAction(ctx, remote, 'customMacro', {});
  assert.deepEqual(native.calls.map((c) => c.cmd), ['key']);
});

test('unknown actions are rejected', async () => {
  reset();
  await assert.rejects(executeAction(ctx, remote, 'nope', {}), /Unknown action/);
});

test('power can be disabled by config', async () => {
  reset();
  ctx = { native, config: { ...config, allowPower: false } };
  await assert.rejects(executeAction(ctx, remote, '__power', { mode: 'lock' }), /disabled/);
  await assert.rejects(executeAction(ctx, remote, '__window', { mode: 'lock' }), /disabled/);
  assert.equal(native.calls.length, 0);
});

let passed = 0;
const failures = [];
for (const { name, fn } of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`ok ${passed} - ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.error(`not ok - ${name}\n  ${err.message}`);
  }
}

console.log(`\n${passed}/${tests.length} action tests passed`);
if (failures.length) {
  for (const { err } of failures) console.error(err.stack);
  process.exit(1);
}
