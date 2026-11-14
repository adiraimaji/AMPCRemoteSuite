import path from 'node:path';

const VK = {
  backspace: 0x08, tab: 0x09, clear: 0x0c, enter: 0x0d, return: 0x0d,
  shift: 0x10, ctrl: 0x11, control: 0x11, alt: 0x12, menu: 0x12, pause: 0x13,
  capslock: 0x14, escape: 0x1b, esc: 0x1b, space: 0x20, pageup: 0x21, pgup: 0x21,
  pagedown: 0x22, pgdn: 0x22, end: 0x23, home: 0x24, left: 0x25, up: 0x26,
  right: 0x27, down: 0x28, select: 0x29, print: 0x2a, execute: 0x2b,
  printscreen: 0x2c, insert: 0x2d, delete: 0x2e, del: 0x2e, help: 0x2f,
  win: 0x5b, lwin: 0x5b, rwin: 0x5c, apps: 0x5d, sleep: 0x5f,
  multiply: 0x6a, add: 0x6b, separator: 0x6c, subtract: 0x6d, decimal: 0x6e, divide: 0x6f,
  numlock: 0x90, scrolllock: 0x91,
  browser_back: 0xa6, browser_forward: 0xa7, browser_refresh: 0xa8, browser_stop: 0xa9,
  browser_search: 0xaa, browser_favorites: 0xab, browser_home: 0xac,
  volume_mute: 0xad, volumemute: 0xad, mute: 0xad,
  volume_down: 0xae, volumedown: 0xae,
  volume_up: 0xaf, volumeup: 0xaf,
  media_next: 0xb0, medianext: 0xb0, next: 0xb0,
  media_prev: 0xb1, mediaprevious: 0xb1, previous: 0xb1, prev: 0xb1,
  media_stop: 0xb2, mediastop: 0xb2, stop: 0xb2,
  media_play_pause: 0xb3, mediaplaypause: 0xb3, playpause: 0xb3, play: 0xb3,
  launch_mail: 0xb4, launch_media: 0xb5, launch_app1: 0xb6, launch_app2: 0xb7,
  semicolon: 0xba, equals: 0xbb, plus: 0xbb, comma: 0xbc, minus: 0xbd, period: 0xbe,
  slash: 0xbf, backtick: 0xc0, grave: 0xc0, bracketleft: 0xdb, backslash: 0xdc,
  bracketright: 0xdd, quote: 0xde
};

for (let i = 1; i <= 24; i += 1) VK[`f${i}`] = 0x6f + i;
for (let i = 0; i <= 9; i += 1) VK[`numpad${i}`] = 0x60 + i;
const MODIFIERS = { ctrl: 0x11, control: 0x11, alt: 0x12, shift: 0x10, win: 0x5b, meta: 0x5b };

function vkFor(name) {
  const key = String(name || '').trim().toLowerCase();
  if (!key) throw new Error('Empty key name');
  if (VK[key] !== undefined) return VK[key];
  if (/^[a-z]$/.test(key)) return key.toUpperCase().charCodeAt(0);
  if (/^[0-9]$/.test(key)) return key.charCodeAt(0);
  if (key.length === 1) return key.charCodeAt(0);
  throw new Error(`Unknown key: ${name}`);
}

function parseCombo(combo) {
  const parts = String(combo).split('+').map((p) => p.trim().toLowerCase()).filter(Boolean);
  if (!parts.length) throw new Error('Empty key combo');
  const key = parts.pop();
  const mods = parts.map((p) => {
    if (MODIFIERS[p] === undefined) throw new Error(`Unknown modifier: ${p}`);
    return MODIFIERS[p];
  });
  return { vk: vkFor(key), mods };
}

function clamp(value, min, max, fallback = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function resolveTarget(config, target) {
  const value = String(target || '').trim();
  if (!value) throw new Error('No target specified');

  const app = (config.apps || []).find((a) => a.id === value);
  if (app) return app.target;

  if (/^https?:\/\//i.test(value)) return value;
  if (/^(ms-settings:|ms-store:|ms-photos:|shell:)[^<>"|]/i.test(value)) return value;

  const resolved = path.resolve(value);
  const allowed = (config.allowedPaths || []).map((p) => path.resolve(p).toLowerCase() + path.sep);
  if (allowed.some((prefix) => (resolved.toLowerCase() + path.sep).startsWith(prefix))) return resolved;

  throw new Error('Target is not in the allow-list (config.json → apps / allowedPaths)');
}

async function runDefinition(ctx, def, args, depth = 0) {
  const { native, config } = ctx;
  if (depth > 4) throw new Error('Macro nesting is too deep');
  if (typeof def === 'string') def = { type: 'keys', keys: [def] };
  if (!def || typeof def !== 'object') throw new Error('Invalid action definition');

  switch (def.type) {
    case 'keys':
    case 'key': {
      const raw = def.keys !== undefined ? def.keys : def.key;
      const keys = Array.isArray(raw) ? raw : raw ? [raw] : [];
      for (const combo of keys) {
        const { vk, mods } = parseCombo(combo);
        await native.call('key', mods.length ? { vk, mods } : { vk });
        await delay(30);
      }
      return { ok: true };
    }
    case 'keydown':
    case 'keyup': {
      const raw = def.keys !== undefined ? def.keys : def.key;
      const keys = Array.isArray(raw) ? raw : raw ? [raw] : [];
      if (!keys.length) throw new Error('No key supplied');
      const down = def.type === 'keydown';
      for (const combo of keys) {
        const { vk, mods } = parseCombo(combo);
        if (down) {
          for (const mod of mods) {
            await native.call('keydown', { vk: mod });
            await delay(10);
          }
          await native.call('keydown', { vk });
        } else {
          await native.call('keyup', { vk });
          for (let i = mods.length - 1; i >= 0; i -= 1) {
            await delay(10);
            await native.call('keyup', { vk: mods[i] });
          }
        }
        await delay(30);
      }
      return { ok: true, keys };
    }
    case 'text':
    case 'type': {
      const text = args.text !== undefined ? String(args.text) : String(def.text || '');
      if (!text) throw new Error('No text supplied');
      await native.call('type', { text: text.slice(0, 4000) });
      if (def.enter) {
        await delay(60);
        await native.call('key', { vk: 0x0d });
      }
      return { ok: true };
    }
    case 'media': {
      const key = String(args.key || def.key || 'playpause');
      await native.call('key', { vk: vkFor(key) });
      return { ok: true, key };
    }
    case 'volume': {
      const op = String(args.op || def.op || 'get');
      if (op === 'set') {
        const value = clamp(args.value !== undefined ? args.value : def.value, 0, 100);
        return { ok: await native.call('volume', { op: 'set', value }) };
      }
      if (op === 'up' || op === 'down') return { ok: await native.call('volume', { op }) };
      if (op === 'mute') return { ok: await native.call('volume', { op: 'mute' }) };
      if (op === 'get') return native.call('volume', { op: 'get' });
      throw new Error(`Unknown volume op: ${op}`);
    }
    case 'pointer': {
      const op = args.op || def.op || 'move';
      if (op === 'move') {
        const dx = Math.round(clamp(args.dx, -3000, 3000));
        const dy = Math.round(clamp(args.dy, -3000, 3000));
        if (dx || dy) await native.call('move', { dx, dy });
        return { ok: true };
      }
      if (op === 'moveabs') {
        const x = clamp(args.x, 0, 1);
        const y = clamp(args.y, 0, 1);
        await native.call('moveabs', { x, y });
        return { ok: true };
      }
      if (op === 'scroll') {
        const dy = Math.round(clamp(args.dy, -2000, 2000));
        if (dy) await native.call('wheel', { delta: -dy, horizontal: false });
        return { ok: true };
      }
      if (op === 'scrollh') {
        const dx = Math.round(clamp(args.dx, -2000, 2000));
        if (dx) await native.call('wheel', { delta: dx, horizontal: true });
        return { ok: true };
      }
      if (op === 'down' || op === 'up') {
        const button = args.button || 'left';
        await native.call('button', { button, down: op === 'down' });
        return { ok: true };
      }
      if (op === 'clickat') {
        const x = clamp(args.x, 0, 1);
        const y = clamp(args.y, 0, 1);
        await native.call('moveabs', { x, y });
        await delay(60);
        await native.call('button', { button: 'left', down: true });
        await native.call('button', { button: 'left', down: false });
        return { ok: true };
      }
      if (op === 'click' || op === 'doubleclick' || op === 'rightclick' || op === 'middleclick') {
        const button = op === 'rightclick' ? 'right' : op === 'middleclick' ? 'middle' : 'left';
        const count = op === 'doubleclick' ? 2 : 1;
        for (let i = 0; i < count; i += 1) {
          await native.call('button', { button, down: true });
          await native.call('button', { button, down: false });
          if (i + 1 < count) await delay(70);
        }
        return { ok: true };
      }
      throw new Error(`Unknown pointer op: ${op}`);
    }
    case 'open':
    case 'launch': {
      const target = resolveTarget(config, def.target || args.target);
      await native.call('open', { target });
      return { ok: true, target };
    }
    case 'power': {
      if (config.allowPower === false) throw new Error('Power actions are disabled in config.json');
      const mode = String(args.mode || def.mode || 'lock');
      if (!['lock', 'monitoroff', 'sleep', 'restart', 'shutdown'].includes(mode)) {
        throw new Error(`Unknown power mode: ${mode}`);
      }
      if ((mode === 'restart' || mode === 'shutdown') && args.confirm !== true) {
        throw new Error('Destructive power actions require confirmation');
      }
      await native.call('power', { mode });
      return { ok: true, mode };
    }
    case 'clipboard': {
      const op = String(args.op || def.op || 'get');
      if (op === 'set') {
        const text = args.text !== undefined ? String(args.text) : String(def.text || '');
        return native.call('clipboard', { op: 'set', text: text.slice(0, 100_000) });
      }
      if (op !== 'get') throw new Error(`Unknown clipboard op: ${op}`);
      const result = await native.call('clipboard', { op: 'get' });
      return { text: String(result?.text || '').slice(0, 100_000) };
    }
    case 'window': {
      const map = {
        switch: ['alt', 'tab'],
        close: ['alt', 'f4'],
        desktop: ['win', 'd'],
        taskview: ['win', 'tab'],
        maximize: ['win', 'up'],
        minimize: ['win', 'down'],
        lock: null
      };
      const mode = String(args.mode || def.mode || 'switch');
      if (!Object.hasOwn(map, mode)) throw new Error(`Unknown window mode: ${mode}`);
      if (mode === 'lock' && config.allowPower === false) {
        throw new Error('Power actions are disabled in config.json');
      }
      const combo = map[mode];
      if (combo) await native.call('key', parseCombo(combo.join('+')));
      else await native.call('power', { mode: 'lock' });
      return { ok: true, mode };
    }
    case 'status':
      return native.call('status');
    case 'procs':
      return native.call('procs', { count: clamp(def.count || 6, 1, 20) });
    case 'sequence': {
      const steps = Array.isArray(def.steps) ? def.steps : [];
      for (const step of steps) {
        await runDefinition(ctx, step, step.args || args, depth + 1);
        await delay(clamp(step.delay || 120, 0, 5000));
      }
      return { ok: true };
    }
    case 'wait':
      await delay(clamp(def.ms || 250, 0, 5000));
      return { ok: true };
    case 'noop':
    case 'screen':
      return { ok: true };
    default:
      throw new Error(`Unknown action type: ${def.type}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BUILTINS = {
  '__keys': { type: 'keys', args: ['keys', 'key'] },
  '__keydown': { type: 'keydown', args: ['keys', 'key'] },
  '__keyup': { type: 'keyup', args: ['keys', 'key'] },
  '__pointer': { type: 'pointer', args: ['op', 'dx', 'dy', 'x', 'y', 'button'] },
  '__text': { type: 'text', args: ['text'] },
  '__volume': { type: 'volume', args: ['op', 'value'] },
  '__power': { type: 'power', args: ['mode', 'confirm'] },
  '__open': { type: 'open', args: ['target'] },
  '__window': { type: 'window', args: ['mode'] },
  '__clipboard': { type: 'clipboard', args: ['op', 'text'] },
  '__procs': { type: 'procs', args: ['count'] },
  '__status': { type: 'status', args: [] },
  '__media': { type: 'media', args: ['key'] },
  '__sequence': { type: 'sequence', args: ['steps'] },
  '__noop': { type: 'noop', args: [] }
};

/**
 * Merge request arguments into a built-in action definition. Only known
 * argument names are copied so a client cannot swap the action type.
 */
function builtinDefinition(builtin, args) {
  const def = { type: builtin.type };
  for (const name of builtin.args) {
    if (args[name] !== undefined) def[name] = args[name];
  }
  return def;
}

export async function executeAction(ctx, remote, actionName, args = {}) {
  const safeArgs = args && typeof args === 'object' ? args : {};
  const custom = remote.actions?.[actionName];
  if (custom) return runDefinition(ctx, custom, safeArgs);

  const builtin = BUILTINS[actionName];
  if (!builtin) throw new Error(`Unknown action: ${actionName}`);
  return runDefinition(ctx, builtinDefinition(builtin, safeArgs), safeArgs);
}

export { parseCombo, vkFor };
