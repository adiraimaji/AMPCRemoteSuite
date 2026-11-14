import fs from 'node:fs';
import path from 'node:path';
import { REMOTES_DIR, readJson, log } from './util.js';

const cache = new Map();
let listCache = null;

function validate(remote, file) {
  if (!remote || typeof remote !== 'object') throw new Error('not an object');
  if (!remote.id || typeof remote.id !== 'string') throw new Error('missing id');
  if (!remote.name || typeof remote.name !== 'string') throw new Error('missing name');
  if (!remote.layout || typeof remote.layout !== 'object') throw new Error('missing layout');
  return {
    id: remote.id,
    name: remote.name,
    icon: remote.icon || '•',
    color: remote.color || '#4f8cff',
    description: remote.description || '',
    layout: remote.layout,
    actions: remote.actions && typeof remote.actions === 'object' ? remote.actions : {},
    file
  };
}

export function loadRemotes({ reload = false } = {}) {
  if (listCache && !reload) return listCache;
  cache.clear();
  let files = [];
  try {
    files = fs.readdirSync(REMOTES_DIR).filter((f) => f.endsWith('.json')).sort();
  } catch {
    log('No remotes directory found');
  }
  const list = [];
  for (const file of files) {
    const full = path.join(REMOTES_DIR, file);
    try {
      const parsed = validate(readJson(full, null), full);
      cache.set(parsed.id, parsed);
      list.push(parsed);
    } catch (err) {
      log(`Skipping remote ${file}: ${err.message}`);
    }
  }
  listCache = list;
  return list;
}

export function getRemote(id) {
  if (!cache.size) loadRemotes();
  return cache.get(id) || null;
}

export function remoteSummaries() {
  return loadRemotes().map(({ id, name, icon, color, description }) => ({
    id, name, icon, color, description
  }));
}
