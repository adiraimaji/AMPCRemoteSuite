/**
 * Builds dist/AM PC Remote.exe as a Node.js Single Executable Application.
 *
 * The executable embeds the server sources, web UI, remote definitions and the
 * native PowerShell helper. On first launch it unpacks them to
 * %LOCALAPPDATA%\AM PC Remote\app and runs the normal server.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rcedit } from 'rcedit';

const root = path.dirname(fileURLToPath(import.meta.url));
const buildDir = root;
const distDir = path.join(root, 'dist');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

const APP_DIRS = ['src', 'web', 'remotes', 'native'];
const APP_FILES = ['config.json', 'package.json'];
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';

function walk(dir, relBase = dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, relBase));
    else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
  }
  return out;
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fail(message) {
  console.error(`\nBuild failed: ${message}`);
  process.exit(1);
}

fs.mkdirSync(distDir, { recursive: true });

const files = [];
for (const dir of APP_DIRS) files.push(...walk(path.join(root, dir)));
files.push(...APP_FILES);
files.sort();

for (const rel of files) {
  if (!fs.statSync(path.join(root, rel)).isFile()) fail(`missing ${rel}`);
}

// Content hash changes whenever anything embedded changes, so an installed copy
// is unpacked again after an upgrade while user config and data are kept.
const hash = crypto.createHash('sha256');
for (const rel of files) {
  hash.update(rel);
  hash.update('\0');
  hash.update(fs.readFileSync(path.join(root, rel)));
  hash.update('\0');
}
const buildId = hash.digest('hex').slice(0, 16);

const manifest = {
  name: pkg.name,
  version: pkg.version,
  build: buildId,
  files
};
fs.writeFileSync(path.join(buildDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const assets = { 'manifest.json': path.join(buildDir, 'manifest.json') };
for (const rel of files) assets[rel] = path.join(root, rel);

const seaConfig = {
  main: path.join(buildDir, 'sea-main.cjs'),
  output: path.join(distDir, 'am-pc-remote.blob'),
  disableExperimentalSEAWarning: true,
  useSnapshot: false,
  useCodeCache: false,
  assets
};
const seaConfigPath = path.join(buildDir, 'sea-config.json');
fs.writeFileSync(seaConfigPath, JSON.stringify(seaConfig, null, 2));

const icon = path.join(buildDir, 'icon.ico');
if (!fs.existsSync(icon)) {
  console.log('Generating icon...');
  execFileSync('powershell.exe', [
    '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-File', path.join(buildDir, 'make-icon.ps1')
  ], { cwd: root, stdio: 'inherit' });
}

console.log(`Embedding ${files.length} files (build ${buildId})...`);
execFileSync(process.execPath, ['--experimental-sea-config', seaConfigPath], {
  cwd: root,
  stdio: 'inherit'
});

const exePath = path.join(distDir, 'AM PC Remote.exe');
if (fs.existsSync(exePath)) fs.rmSync(exePath, { force: true });
fs.copyFileSync(process.execPath, exePath);

console.log('Setting icon and version information...');
await rcedit(exePath, {
  icon,
  'file-version': pkg.version,
  'product-version': pkg.version,
  'version-string': {
    CompanyName: 'AM PC Remote',
    FileDescription: 'AM PC Remote Server',
    InternalName: 'AM PC Remote',
    LegalCopyright: 'AM PC Remote',
    OriginalFilename: 'AM PC Remote.exe',
    ProductName: 'AM PC Remote'
  }
});

console.log('Injecting application blob...');
const postjectCli = path.join(root, 'node_modules', 'postject', 'dist', 'cli.js');
if (!fs.existsSync(postjectCli)) fail('postject is not installed; run npm install');
execFileSync(process.execPath, [
  postjectCli,
  exePath,
  'NODE_SEA_BLOB',
  seaConfig.output,
  '--sentinel-fuse',
  SEA_FUSE
], { cwd: root, stdio: 'inherit' });

fs.rmSync(seaConfig.output, { force: true });

// Node ships as a console executable. Switch the PE optional-header subsystem
// to Windows GUI so double-clicking the server never opens a command prompt.
// The server writes to data\server.log and uses the tray icon instead.
function setGuiSubsystem(file) {
  const fd = fs.openSync(file, 'r+');
  try {
    const dos = Buffer.alloc(0x40);
    fs.readSync(fd, dos, 0, dos.length, 0);
    if (dos.readUInt16LE(0) !== 0x5a4d) throw new Error('not a PE file (missing MZ header)');
    const peOffset = dos.readUInt32LE(0x3c);
    const signature = Buffer.alloc(4);
    fs.readSync(fd, signature, 0, 4, peOffset);
    if (signature.toString('latin1') !== 'PE\u0000\u0000') {
      throw new Error('not a PE file (missing PE signature)');
    }
    const subsystemOffset = peOffset + 0x5c;
    const current = Buffer.alloc(2);
    fs.readSync(fd, current, 0, 2, subsystemOffset);
    const previous = current.readUInt16LE(0);
    if (previous !== 2) {
      const gui = Buffer.alloc(2);
      gui.writeUInt16LE(2);
      fs.writeSync(fd, gui, 0, 2, subsystemOffset);
    }
    return previous;
  } finally {
    fs.closeSync(fd);
  }
}

console.log('Switching executable to the Windows GUI subsystem (no console window)...');
const previousSubsystem = setGuiSubsystem(exePath);
console.log(`PE subsystem: ${previousSubsystem} -> 2 (GUI)`);

const sizeMb = (fs.statSync(exePath).size / (1024 * 1024)).toFixed(1);
console.log(`\nBuilt ${exePath}`);
console.log(`Size: ${sizeMb} MB`);
console.log(`SHA-256: ${sha256File(exePath)}`);
console.log('Copy this one file anywhere and double-click it to run AM PC Remote.');
