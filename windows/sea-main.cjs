'use strict';

/**
 * Bootstrapper embedded in AM PC Remote.exe (Node.js Single Executable
 * Application).
 *
 * The executable is built for the Windows GUI subsystem, so it never opens a
 * console window. Everything that would normally be printed is written to
 * %LOCALAPPDATA%\AM PC Remote\bootstrap.log and serious problems are shown in
 * a native message box.
 *
 * On launch the embedded files are unpacked to
 * %LOCALAPPDATA%\AM PC Remote\app and the normal server is imported from there.
 * Keeping real files on disk means the web UI, remotes, native helpers, tray
 * and data directory behave exactly like the source version.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn, execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { getAsset } = require('node:sea');

const APP_NAME = 'AM PC Remote';
const args = process.argv.slice(2);

function appRootDir() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, APP_NAME, 'app');
}

const root = appRootDir();
const logFile = path.join(root, 'data', 'bootstrap.log');

function writeLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, line);
  } catch {
    /* logging must never stop the app */
  }
}

function quote(value) {
  return String(value).replace(/'/g, "''");
}

function messageBox(title, text) {
  const body = String(text ?? '');
  const trimmed = body.length > 1800 ? `${body.slice(0, 1800)}\n...` : body;
  const command = [
    'Add-Type -AssemblyName System.Windows.Forms',
    `[System.Windows.Forms.MessageBox]::Show('${quote(trimmed)}','${quote(title)}','OK','Information') | Out-Null`
  ].join('; ');
  try {
    execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', command
    ], { windowsHide: true, stdio: 'ignore' });
  } catch {
    /* A message box is best effort; the log still has the detail. */
  }
}

function openAdmin(port) {
  try {
    spawn('cmd.exe', ['/c', 'start', '', `http://localhost:${port}/admin`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    }).unref();
  } catch {
    /* opening a browser is best-effort */
  }
}

function readConfig() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
    return config && typeof config === 'object' ? config : {};
  } catch {
    return {};
  }
}

function configPort(config) {
  const port = Number(config.port);
  if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  return 9600;
}

function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '0.0.0.0');
  });
}

async function ourServerOn(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1800)
    });
    const info = await response.json();
    return Boolean(info && info.ok && info.name);
  } catch {
    return false;
  }
}

function showPin({ rotate }) {
  const config = readConfig();
  const load = createRequire(path.join(root, 'package.json'));
  const auth = load(path.join(root, 'src', 'auth.js'));
  auth.initAuth(config, { quiet: true });
  if (rotate) {
    const pin = auth.rotatePin();
    writeLog('Pairing PIN rotated from the command line');
    messageBox(`${APP_NAME} - new PIN`, `New pairing PIN: ${pin}\n\nEvery paired device was signed out.`);
    return;
  }
  messageBox(`${APP_NAME} - pairing PIN`, `Pairing PIN: ${auth.getPin()}`);
}

function showHelp() {
  const manifestVersion = (() => {
    try {
      return JSON.parse(getAsset('manifest.json', 'utf8')).version;
    } catch {
      return '';
    }
  })();
  messageBox(
    `${APP_NAME} ${manifestVersion}`.trim(),
    [
      'Usage:',
      '  "AM PC Remote.exe"             Start the server (tray icon + admin page)',
      '  "AM PC Remote.exe" --no-open   Start without opening the admin page',
      '  "AM PC Remote.exe" pin         Show the pairing PIN',
      '  "AM PC Remote.exe" pin new     Rotate the PIN and sign out all devices',
      '  "AM PC Remote.exe" --version   Show the version',
      '',
      `Application files: ${root}`,
      `Log: ${path.join(root, 'data', 'server.log')}`
    ].join('\n')
  );
}

(async () => {
  try {
    const manifest = JSON.parse(getAsset('manifest.json', 'utf8'));
    fs.mkdirSync(root, { recursive: true });

    if (args.includes('--help') || args.includes('-h')) {
      showHelp();
      return;
    }

    if (args.includes('--version')) {
      messageBox(APP_NAME, manifest.version);
      return;
    }

    // Re-extract when the executable is newer than the unpacked copy. config.json
    // is user-editable, so it is only written when missing.
    const stampFile = path.join(root, '.build');
    let stamp = '';
    try {
      stamp = fs.readFileSync(stampFile, 'utf8').trim();
    } catch {
      /* first run */
    }
    const upToDate = stamp === manifest.build
      && manifest.files.every((rel) => {
        try {
          return fs.statSync(path.join(root, rel)).isFile();
        } catch {
          return false;
        }
      });

    if (!upToDate) {
      writeLog(`Preparing application files (build ${manifest.build})`);
      let written = 0;
      for (const rel of manifest.files) {
        if (!rel || rel.includes('..') || path.isAbsolute(rel)) {
          throw new Error(`Invalid application manifest entry: ${rel}`);
        }
        const dest = path.join(root, rel);
        if (rel === 'config.json' && fs.existsSync(dest)) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(getAsset(rel)));
        written += 1;
      }
      fs.writeFileSync(stampFile, `${manifest.build}\n`);
      writeLog(`Prepared ${written} application files in ${root}`);
    }

    process.chdir(root);

    const config = readConfig();
    const port = configPort(config);

    if (args.includes('pin')) {
      showPin({ rotate: args.includes('new') || args.includes('rotate') });
      return;
    }

    if (!(await portFree(port))) {
      if (await ourServerOn(port)) {
        writeLog(`${APP_NAME} is already running on port ${port}; opening the admin page`);
        if (!args.includes('--no-open')) openAdmin(port);
        return;
      }
      writeLog(`TCP port ${port} is used by another program`);
      messageBox(
        `${APP_NAME} could not start`,
        `TCP port ${port} is already used by another program.\n\n` +
        `Stop that program or change "port" in:\n${path.join(root, 'config.json')}\n\n` +
        `Log: ${path.join(root, 'data', 'server.log')}`
      );
      process.exitCode = 1;
      return;
    }

    if (!args.includes('--no-open')) {
      setTimeout(() => openAdmin(port), 1500);
    }

    // Marks the packaged build so the tray can restart the executable and the
    // start-with-Windows shortcut points at the right file.
    process.env.AMPC_STANDALONE = '1';
    process.env.AMPC_EXE = process.execPath;
    process.title = APP_NAME;
    writeLog(`Starting ${APP_NAME} ${manifest.version} from ${process.execPath}`);

    // The injected SEA main cannot import() from the real filesystem, but a
    // require created from a file URL can load the extracted ESM entry point
    // (Node's require(esm) support).
    const load = createRequire(path.join(root, 'package.json'));
    load(path.join(root, 'src', 'server.js'));
  } catch (err) {
    const detail = err && err.stack ? err.stack : String(err);
    writeLog(`Fatal: ${detail}`);
    messageBox(
      `${APP_NAME} could not start`,
      `${detail}\n\nLog: ${logFile}`
    );
    process.exitCode = 1;
  }
})();
