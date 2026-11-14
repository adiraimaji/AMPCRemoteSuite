import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { log } from './util.js';

/**
 * Long-lived PowerShell bridge to the Win32 input helper.
 * Requests are newline-delimited JSON; responses carry the same id.
 */
export class NativeHost {
  constructor(scriptPath, { timeoutMs = 10_000 } = {}) {
    this.scriptPath = scriptPath;
    this.timeoutMs = timeoutMs;
    this.child = null;
    this.ready = false;
    this.waiters = [];
    this.pending = new Map();
    this.nextId = 1;
    this.starting = null;
    this.lastError = null;
  }

  get platformSupported() {
    return process.platform === 'win32';
  }

  start() {
    if (this.starting) return this.starting;
    if (!this.platformSupported) {
      this.lastError = 'Native input is only available on Windows.';
      return Promise.reject(new Error(this.lastError));
    }

    this.starting = new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', this.scriptPath],
          { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
        );
      } catch (err) {
        this.starting = null;
        reject(err);
        return;
      }
      this.child = child;

      const settleReady = (ok, err) => {
        this.ready = ok;
        if (ok) {
          this.lastError = null;
          resolve();
        } else {
          this.lastError = err ? err.message : 'Input host failed to start';
          reject(err || new Error(this.lastError));
        }
        for (const waiter of this.waiters.splice(0)) ok ? waiter.resolve() : waiter.reject(err);
      };

      const readyTimer = setTimeout(() => {
        if (!this.ready) settleReady(false, new Error('Input host did not become ready in time'));
      }, 30_000);

      const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      rl.on('line', (line) => {
        const text = line.trim();
        if (!text) return;
        let message;
        try {
          message = JSON.parse(text);
        } catch {
          log('native non-JSON output:', text.slice(0, 200));
          return;
        }
        if (message.event === 'ready') {
          clearTimeout(readyTimer);
          log('Native input host ready');
          settleReady(true);
          return;
        }
        if (message.id !== undefined && this.pending.has(message.id)) {
          const entry = this.pending.get(message.id);
          this.pending.delete(message.id);
          clearTimeout(entry.timer);
          if (message.ok) entry.resolve(message.result);
          else entry.reject(new Error(message.error || 'Native command failed'));
        }
      });

      child.stderr.on('data', (chunk) => {
        const text = chunk.toString().trim();
        if (!text) return;
        this.lastError = text.split('\n')[0];
        if (!this.ready) {
          clearTimeout(readyTimer);
          settleReady(false, new Error(text.slice(0, 300)));
        } else {
          log('native stderr:', text.slice(0, 300));
        }
      });

      child.on('exit', (code) => {
        clearTimeout(readyTimer);
        this.ready = false;
        this.child = null;
        this.starting = null;
        if (this.readyTimer) clearTimeout(this.readyTimer);
        const err = new Error(`Input host exited (code ${code})`);
        for (const waiter of this.waiters.splice(0)) waiter.reject(err);
        for (const [, entry] of this.pending) {
          clearTimeout(entry.timer);
          entry.reject(err);
        }
        this.pending.clear();
        if (code !== 0) log('Input host stopped:', err.message);
      });
    });

    return this.starting.catch((err) => {
      this.starting = null;
      throw err;
    });
  }

  async waitReady() {
    if (this.ready) return;
    await this.start();
    if (!this.ready) throw new Error(this.lastError || 'Input host unavailable');
  }

  async call(cmd, args = {}, timeoutMs = this.timeoutMs) {
    await this.waitReady();
    if (!this.child) throw new Error('Input host is not running');
    const id = this.nextId++;
    const payload = JSON.stringify({ id, cmd, ...args });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Native command timed out: ${cmd}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(payload + '\n', (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  stop() {
    if (this.child) {
      try {
        this.child.stdin.end();
      } catch {
        /* ignore */
      }
      try {
        this.child.kill();
      } catch {
        /* ignore */
      }
    }
    this.child = null;
    this.ready = false;
  }
}
