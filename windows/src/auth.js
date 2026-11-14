import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  DATA_DIR, ensureDir, readJson, writeJson, randomId, sha256, safeEqual, log
} from './util.js';

const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const SECRET_FILE = path.join(DATA_DIR, 'secret.key');
const CLIENTS_FILE = path.join(DATA_DIR, 'clients.json');
const NONCE_TTL_MS = 60_000;
const MAX_ATTEMPTS = 8;
const ATTEMPT_WINDOW_MS = 5 * 60_000;

let settings;
let secret;
let clients;
let tokenDays = 30;
const nonces = new Map();
const attempts = new Map();

function load() {
  ensureDir(DATA_DIR);

  if (!fs.existsSync(SECRET_FILE)) {
    fs.writeFileSync(SECRET_FILE, randomId(32));
  }
  secret = fs.readFileSync(SECRET_FILE, 'utf8').trim();

  settings = readJson(SETTINGS_FILE, null);
  if (!settings || typeof settings !== 'object') {
    settings = { pin: makePin(), requirePin: true, createdAt: new Date().toISOString() };
    writeJson(SETTINGS_FILE, settings);
  }
  if (!settings.pin || String(settings.pin).length < 4) {
    settings.pin = makePin();
    writeJson(SETTINGS_FILE, settings);
  }

  clients = readJson(CLIENTS_FILE, []);
  if (!Array.isArray(clients)) clients = [];
}

export function makePin() {
  return String(crypto.randomInt(100000, 1000000));
}

export function initAuth(config, { quiet = false } = {}) {
  load();
  if (settings.requirePin === undefined) settings.requirePin = config.requirePin !== false;
  const days = Number(config.tokenDays);
  tokenDays = Number.isFinite(days) && days > 0 ? Math.min(days, 365) : 30;
  if (!quiet) {
    log(`Pairing PIN: ${settings.pin}${settings.requirePin ? '' : '  (PIN disabled)'}`);
  }
  return settings;
}

export function getPin() {
  return settings.pin;
}

export function revokeAllClients() {
  const before = clients.length;
  clients = [];
  writeJson(CLIENTS_FILE, clients);
  return before;
}

export function rotatePin({ revokeDevices = true } = {}) {
  settings.pin = makePin();
  writeJson(SETTINGS_FILE, settings);
  nonces.clear();
  attempts.clear();
  if (revokeDevices) revokeAllClients();
  return settings.pin;
}

export function setRequirePin(value) {
  settings.requirePin = Boolean(value);
  writeJson(SETTINGS_FILE, settings);
  return settings.requirePin;
}

export function pinRequired(config) {
  return settings.requirePin !== false && config.requirePin !== false;
}

export function newNonce() {
  const nonce = randomId(16);
  nonces.set(nonce, Date.now() + NONCE_TTL_MS);
  if (nonces.size > 500) {
    const now = Date.now();
    for (const [key, exp] of nonces) if (exp < now) nonces.delete(key);
  }
  return nonce;
}

function clientKey(ip) {
  return String(ip || 'unknown');
}

export function authLocked(ip) {
  const entry = attempts.get(clientKey(ip));
  if (!entry) return 0;
  if (Date.now() > entry.resetAt) {
    attempts.delete(clientKey(ip));
    return 0;
  }
  if (entry.count < MAX_ATTEMPTS) return 0;
  return Math.ceil((entry.resetAt - Date.now()) / 1000);
}

function registerFailure(ip) {
  const key = clientKey(ip);
  const now = Date.now();
  let entry = attempts.get(key);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + ATTEMPT_WINDOW_MS };
  }
  entry.count += 1;
  attempts.set(key, entry);
}

export function verifyPin({ nonce, proof, ip }) {
  if (authLocked(ip) > 0) return { ok: false, error: 'Too many attempts. Try again later.' };

  const expires = nonces.get(String(nonce || ''));
  if (!expires || expires < Date.now()) {
    registerFailure(ip);
    return { ok: false, error: 'Handshake expired. Reload the page.' };
  }
  nonces.delete(String(nonce));

  const expected = sha256(`${nonce}:${settings.pin}`);
  if (!safeEqual(expected, String(proof || '').toLowerCase())) {
    registerFailure(ip);
    return { ok: false, error: 'Wrong PIN.' };
  }

  attempts.delete(clientKey(ip));
  return { ok: true };
}

export function issueToken({ name, ip, platform }) {
  const id = randomId(12);
  const exp = Date.now() + tokenDays * 24 * 60 * 60 * 1000;
  const sig = crypto.createHmac('sha256', secret).update(`${id}.${exp}`).digest('hex');
  const client = {
    id,
    name: String(name || 'Phone').slice(0, 60),
    platform: String(platform || 'web').slice(0, 40),
    ip: String(ip || ''),
    createdAt: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    exp
  };
  clients.push(client);
  if (clients.length > 50) clients = clients.slice(-50);
  writeJson(CLIENTS_FILE, clients);
  return { token: `${id}.${exp}.${sig}`, client };
}

export function verifyToken(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [id, expRaw, sig] = parts;
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < Date.now()) return null;
  const expected = crypto.createHmac('sha256', secret).update(`${id}.${exp}`).digest('hex');
  if (!safeEqual(expected, sig)) return null;
  const client = clients.find((c) => c.id === id);
  if (!client) return null;
  return client;
}

export function touchClient(id) {
  const client = clients.find((c) => c.id === id);
  if (!client) return;
  const now = new Date().toISOString();
  if (!client.lastSeen || Date.now() - new Date(client.lastSeen).getTime() > 60_000) {
    client.lastSeen = now;
    writeJson(CLIENTS_FILE, clients);
  }
}

export function revokeClient(id) {
  const before = clients.length;
  clients = clients.filter((c) => c.id !== id);
  writeJson(CLIENTS_FILE, clients);
  return clients.length !== before;
}

export function listClients() {
  return clients
    .filter((c) => c.exp > Date.now())
    .map(({ id, name, platform, ip, createdAt, lastSeen }) => ({
      id, name, platform, ip, createdAt, lastSeen
    }));
}
