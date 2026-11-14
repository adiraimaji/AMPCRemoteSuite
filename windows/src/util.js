import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.join(ROOT, 'data');
export const WEB_DIR = path.join(ROOT, 'web');
export const REMOTES_DIR = path.join(ROOT, 'remotes');
export const VERSION = '1.0.0';

const LOG_FILE = path.join(DATA_DIR, 'server.log');
const LOG_MAX_BYTES = 2 * 1024 * 1024;
let loggingReady = false;

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson(file, fallback) {
  try {
    // Notepad and some PowerShell versions save UTF-8 with a BOM.
    const text = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export function randomId(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

export function localIpList() {
  const out = [];
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

export function isLoopback(addr) {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1';
}

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8'
};

export function mimeFor(file) {
  return MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
}

export function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

export function getLogFile() {
  return LOG_FILE;
}

function writeLine(level, parts) {
  const line = `[${timestamp()}]${level ? ` ${level}` : ''} ${parts.map((p) => {
    if (typeof p === 'string') return p;
    if (p instanceof Error) return p.stack || p.message;
    try {
      return JSON.stringify(p);
    } catch {
      return String(p);
    }
  }).join(' ')}\n`;

  try {
    ensureDir(DATA_DIR);
    try {
      const stat = fs.statSync(LOG_FILE);
      if (stat.size > LOG_MAX_BYTES) {
        fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
      }
    } catch {
      /* first log line */
    }
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    /* logging must never stop the server */
  }

  // The standalone build uses the Windows GUI subsystem so no console window
  // appears. Writing to an invalid stdout must stay best-effort.
  const stream = level === 'ERROR' || level === 'WARN' ? process.stderr : process.stdout;
  try {
    stream?.write?.(line);
  } catch {
    /* no console attached */
  }
}

/**
 * Route console output to the log file. Called before anything else starts so
 * uncaught errors and the native bridge still leave diagnostics on disk when
 * the server runs without a console window.
 */
export function initLogging() {
  if (loggingReady) return;
  loggingReady = true;
  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console)
  };
  console.log = (...args) => writeLine('', args);
  console.info = (...args) => writeLine('INFO', args);
  console.warn = (...args) => writeLine('WARN', args);
  console.error = (...args) => writeLine('ERROR', args);
  // Keep the originals reachable for tests that explicitly want a console.
  console.__original = original;
}

export function log(...parts) {
  writeLine('', parts);
}

export function logError(...parts) {
  writeLine('ERROR', parts);
}
